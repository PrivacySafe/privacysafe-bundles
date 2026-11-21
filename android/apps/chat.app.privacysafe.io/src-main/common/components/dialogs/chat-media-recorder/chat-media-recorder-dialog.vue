<!--
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
-->
<script lang="ts" setup>
  import { computed, inject, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nIcon,
    Ui3nProgressLinear,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import { makeLogger } from '@shared/logger';
  import type { RecordingKind } from '@shared/constants/media-recording';
  import {
    useMediaRecorder,
    type MediaRecordingResult,
    type RecordingFailure,
  } from './useMediaRecorder';

  const log = makeLogger('MediaRecorderDialog');

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<MediaRecordingResult>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: MediaRecordingResult }): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { canRecordAudio, canRecordVideo, isMobileMode } = storeToRefs(useAppStore());
  const { refreshRecordingSupport } = useAppStore();

  const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');
  const videoEl = useTemplateRef<HTMLVideoElement>('videoEl');

  const {
    stage,
    kind,
    stream,
    analyser,
    elapsedAsText,
    limitAsText,
    usedPercent,
    useVideoElement,
    start,
    stop,
    cancel,
    resetToChoice,
  } = useMediaRecorder({ onFailure: reportFailure });

  const isRecording = computed(() => stage.value === 'recording');
  const isBusy = computed(() => (stage.value === 'preparing') || (stage.value === 'finishing'));

  /**
   * The recording waiting to be approved, and this dialog's URL for playing it
   * back. Held here rather than in the recorder: it is a thing to look at, and
   * the recorder is done with it.
   */
  const pending = ref<MediaRecordingResult | null>(null);
  const pendingUrl = ref<string | null>(null);

  /** Warn while the nearer of the two limits is within reach. */
  const isNearLimit = computed(() => usedPercent.value >= 90);

  function reportFailure(failure: RecordingFailure) {
    $createNotice({ type: 'error', content: t(`chat.recording.error.${failure}`) });
    // A device that turned out not to be there should stop being offered.
    if (failure === 'no_device') {
      refreshRecordingSupport().catch(e => log.error('Failed to re-probe the devices', e));
    }
    emits('action', { event: 'close' });
  }

  async function beginRecording(k: RecordingKind) {
    const result = await start(k);
    if (!result) {
      // Cancelled, or already reported through onFailure.
      return;
    }
    pending.value = result;
    pendingUrl.value = URL.createObjectURL(result.blob);

    // Said here rather than after the message is sent: a recording that a limit
    // cut short is exactly the one the user may want to record again, and here
    // they still can.
    if (result.stoppedBy !== 'user') {
      $createNotice({ type: 'info', content: t(`chat.recording.stopped.${result.stoppedBy}`) });
    }
  }

  /** Drops what is being reviewed. The blob itself is not this dialog's. */
  function forgetPending() {
    if (pendingUrl.value) {
      URL.revokeObjectURL(pendingUrl.value);
      pendingUrl.value = null;
    }
    pending.value = null;
  }

  function sendPending() {
    const result = pending.value;
    if (!result) {
      return;
    }
    // Handed on first, and only then let go of: dropping the URL while the
    // review is still on screen would blank the element it is playing in.
    // The recording itself travels with the event; the URL was this dialog's.
    emits('action', { event: 'confirm', data: result });
    forgetPending();
  }

  async function rerecord() {
    // Read before the reset, which is what puts `kind` back to null.
    const k = kind.value;
    forgetPending();
    resetToChoice();
    if (k) {
      await beginRecording(k);
    }
  }

  function onCancel() {
    forgetPending();
    cancel();
    emits('action', { event: 'close' });
  }

  function handleAction(e: { event: Ui3nDialogEvent }) {
    forgetPending();
    cancel();
    emits('action', e);
  }

  onBeforeUnmount(forgetPending);

  /* the camera preview */

  // Bound to the element by hand rather than through an attribute: srcObject is
  // a property, not an attribute, so `:src-object` would be ignored.
  watch(
    [stream, videoEl],
    async ([mediaStream, el]) => {
      if (!el) {
        return;
      }
      useVideoElement(el);
      if (!mediaStream) {
        el.srcObject = null;
        return;
      }
      el.srcObject = mediaStream;
      await nextTick();
      // Autoplay is not to be relied on: an unmuted one is refused outright in
      // Android's WebView, and even a muted one is better asked for explicitly
      // than left to the attribute. The element is muted anyway - playing the
      // microphone back into the speakers would give feedback.
      try {
        await el.play();
      } catch (err) {
        log.error('The camera preview would not start playing', err);
      }
    },
    { immediate: true },
  );

  /* the level meter */

  let animation: number | undefined;
  // A plain variable, not a ref: the template never reads it, and wrapping a
  // typed array in a ref only makes Vue walk it.
  // Typed over ArrayBuffer, not the default ArrayBufferLike: getByteFrequencyData
  // takes a view backed by a plain ArrayBuffer, and a bare `Uint8Array`
  // annotation widens to include SharedArrayBuffer.
  let frequencyData: Uint8Array<ArrayBuffer> | null = null;

  function drawLevels() {
    const node = analyser.value;
    const canvas = canvasEl.value;
    if (!node || !canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    if (!frequencyData || (frequencyData.length !== node.frequencyBinCount)) {
      frequencyData = new Uint8Array(node.frequencyBinCount);
    }
    const data = frequencyData;
    node.getByteFrequencyData(data);

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const columns = data.length;
    const columnWidth = width / columns;
    ctx.fillStyle = 'currentColor';
    for (let i = 0; i < columns; i++) {
      // Mirrored around the middle, so that silence reads as a flat line rather
      // than as an empty box.
      const columnHeight = Math.max(1, (data[i] / 255) * height * 0.9);
      ctx.fillRect(
        i * columnWidth,
        (height - columnHeight) / 2,
        Math.max(1, columnWidth - 1),
        columnHeight,
      );
    }

    animation = window.requestAnimationFrame(drawLevels);
  }

  watch(analyser, node => {
    stopDrawing();
    if (!node) {
      return;
    }
    nextTick(() => {
      const canvas = canvasEl.value;
      if (!canvas) {
        return;
      }
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      animation = window.requestAnimationFrame(drawLevels);
    });
  });

  function stopDrawing() {
    if (animation !== undefined) {
      window.cancelAnimationFrame(animation);
      animation = undefined;
    }
  }

  onBeforeUnmount(stopDrawing);
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="[$style.body, isMobileMode && $style.bodyMobile]">
        <!-- Choosing what to record -->
        <template v-if="stage === 'choice'">
          <p :class="$style.hint">
            {{ t('chat.recording.hint.choose') }}
          </p>

          <div :class="$style.choices">
            <button
              type="button"
              :class="[$style.choice, !canRecordAudio && $style.choiceDisabled]"
              :disabled="!canRecordAudio"
              @click="beginRecording('voice')"
            >
              <ui3n-icon
                icon="round-mic"
                size="32"
                color="var(--color-icon-block-accent-default)"
              />
              <span :class="$style.choiceLabel">{{ t('chat.recording.label.voice') }}</span>
              <span :class="$style.choiceNote">
                {{ canRecordAudio
                  ? t('chat.recording.note.limit', { limit: t('chat.recording.limit.voice') })
                  : t('chat.recording.note.no_microphone') }}
              </span>
            </button>

            <button
              type="button"
              :class="[$style.choice, !canRecordVideo && $style.choiceDisabled]"
              :disabled="!canRecordVideo"
              @click="beginRecording('video')"
            >
              <ui3n-icon
                icon="outline-videocam"
                size="32"
                color="var(--color-icon-block-accent-default)"
              />
              <span :class="$style.choiceLabel">{{ t('chat.recording.label.video') }}</span>
              <span :class="$style.choiceNote">
                {{ canRecordVideo
                  ? t('chat.recording.note.limit', { limit: t('chat.recording.limit.video') })
                  : t('chat.recording.note.no_camera') }}
              </span>
            </button>
          </div>

          <p :class="$style.footnote">
            {{ t('chat.recording.hint.sent_at_once') }}
          </p>
        </template>

        <!-- Reviewing what was recorded, before it goes anywhere -->
        <template v-else-if="stage === 'review'">
          <div :class="$style.stage">
            <!-- Native controls on purpose: seeking and the volume are what
                 makes this a review, and there is no attachment to stream - the
                 blob is right here. -->
            <video
              v-if="kind === 'video'"
              :src="pendingUrl!"
              controls
              playsinline
              preload="metadata"
              :class="$style.preview"
            />

            <audio
              v-else
              :src="pendingUrl!"
              controls
              preload="metadata"
              :class="$style.reviewAudio"
            />
          </div>

          <div :class="$style.timerRow">
            <span :class="$style.timer">{{ elapsedAsText }}</span>
          </div>

          <p :class="$style.footnote">
            {{ t('chat.recording.hint.review') }}
          </p>
        </template>

        <!-- Recording -->
        <template v-else>
          <div :class="$style.stage">
            <video
              v-if="kind === 'video'"
              ref="videoEl"
              muted
              playsinline
              autoplay
              :class="$style.preview"
            />

            <canvas
              v-else
              ref="canvasEl"
              :class="$style.levels"
            />
          </div>

          <div :class="$style.timerRow">
            <span :class="[$style.timer, isNearLimit && $style.timerNearLimit]">
              {{ elapsedAsText }}
            </span>
            <span :class="$style.limit">/&nbsp;{{ limitAsText }}</span>
          </div>

          <ui3n-progress-linear
            bg-color="transparent"
            height="4"
            :value="usedPercent"
          />

          <p :class="$style.footnote">
            {{ isBusy ? t('chat.recording.hint.preparing') : t('chat.recording.hint.recording') }}
          </p>
        </template>

        <div :class="$style.actions">
          <ui3n-button
            type="secondary"
            @click="onCancel"
          >
            {{ t('chat.recording.btn.cancel') }}
          </ui3n-button>

          <template v-if="stage === 'review'">
            <ui3n-button
              type="secondary"
              @click="rerecord"
            >
              {{ t('chat.recording.btn.rerecord') }}
            </ui3n-button>

            <ui3n-button @click="sendPending">
              {{ t('chat.recording.btn.send') }}
            </ui3n-button>
          </template>

          <ui3n-button
            v-else-if="stage !== 'choice'"
            :disabled="!isRecording"
            @click="stop('user')"
          >
            {{ t('chat.recording.btn.stop') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-m);
    padding: var(--spacing-m);
  }

  .hint,
  .footnote {
    margin: 0;
    font-size: var(--font-13);
    line-height: var(--font-18);
    color: var(--color-text-block-primary-default);
  }

  .footnote {
    font-size: var(--font-12);
    color: var(--color-text-block-secondary-default);
  }

  .choices {
    display: flex;
    column-gap: var(--spacing-m);

    .bodyMobile & {
      flex-direction: column;
      row-gap: var(--spacing-s);
    }
  }

  .choice {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    row-gap: var(--spacing-xs);
    padding: var(--spacing-m) var(--spacing-s);
    border: 1px solid var(--color-border-block-primary-default);
    border-radius: var(--spacing-s);
    background-color: var(--color-bg-block-primary-default);
    cursor: pointer;

    &:hover:not(.choiceDisabled) {
      background-color: var(--color-bg-block-primary-hover);
    }

    &.choiceDisabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  .choiceLabel {
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
  }

  .choiceNote {
    font-size: var(--font-11);
    line-height: var(--font-14);
    text-align: center;
    color: var(--color-text-block-secondary-default);
  }

  .stage {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-s);
    overflow: hidden;
  }

  .preview {
    width: 100%;
    max-height: 320px;
    object-fit: contain;
    background-color: oklch(20% 0 0deg);
  }

  .reviewAudio {
    width: 100%;
  }

  .levels {
    width: 100%;
    height: 96px;

    /* The bars are painted with `currentcolor`, so the accent lives here. */
    color: var(--color-icon-block-accent-default);
  }

  .timerRow {
    display: flex;
    justify-content: center;
    align-items: baseline;
    column-gap: var(--spacing-xs);
  }

  .timer {
    font-size: var(--font-24);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-block-primary-default);

    &.timerNearLimit {
      color: var(--error-content-default);
    }
  }

  .limit {
    font-size: var(--font-13);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-block-secondary-default);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    column-gap: var(--spacing-s);
  }
</style>
