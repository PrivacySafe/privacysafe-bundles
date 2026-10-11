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
  import { onMounted, ref, inject, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { QRCodeStyling } from 'beautiful-qr-code';
  import {
    Ui3nDialog,
    Ui3nButton,
    Ui3nTooltip,
    type Ui3nDialogComponentProps,
    Ui3nIcon,
  } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import pSafeLogoColoredRaw from '@main/common/assets/images/privacysafe_icon.svg?raw';
  import pSafeLogoMonoRaw from '@main/common/assets/images/pr_safe_mono.svg?raw';
  import { useAppStore } from '@main/common/store/app.store';
  import { buildAddContactUrl } from '@main/common/utils/contact-presentation';
  import type { Person } from '@main/types';

  const props = defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
    contactData: Person | null | undefined;
  }>();

  const { user } = storeToRefs(useAppStore());
  const { t } = useI18n();
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const contactURL = ref<string>('');
  let qrCode: QRCodeStyling | null = null;

  const showColorPicker = ref<boolean>(false);
  const colors = ['#000000', '#2449C0', '#464852', '#73694F', '#55733F', '#EE691A', '#BB617B', '#7651C5'];
  const selectedColor = ref(colors[0]);
  const qrCodePanelRef = ref<HTMLDivElement | null>(null);

  const coloredLogoDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(pSafeLogoColoredRaw)}`;
  const monoLogoCache = new Map<string, string>();

  function getMonoLogoDataUri(targetColor: string): string {
    const cached = monoLogoCache.get(targetColor);
    if (cached) {
      return cached;
    }

    const modifiedSvg = pSafeLogoMonoRaw.replace('<path ', `<path fill="${targetColor}" `);
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(modifiedSvg)}`;
    monoLogoCache.set(targetColor, dataUri);
    return dataUri;
  }

  function getLogoForColor(color: string): string {
    return color === '#000000' ? coloredLogoDataUri : getMonoLogoDataUri(color);
  }

  async function selectColor(color: string) {
    selectedColor.value = color;

    if (qrCode) {
      await qrCode.update({
        foregroundColor: color,
        logoUrl: getLogoForColor(color),
      });
    }
  }

  async function generateQRcode() {
    const mail = props.contactData?.mail;
    if (!mail) {
      contactURL.value = '';
      if (qrCodePanelRef.value) {
        qrCodePanelRef.value.innerHTML = '';
      }
      return;
    }

    contactURL.value = buildAddContactUrl({
      mail,
      name: props.contactData?.name,
      isOwnAddress: mail === user.value,
    });

    qrCode = new QRCodeStyling({
      data: contactURL.value,
      foregroundColor: selectedColor.value,
      backgroundColor: '#ffffff',
      radius: 1,
      logoUrl: getLogoForColor(selectedColor.value),
      padding: 2,
      type: 'canvas',
    });

    if (qrCodePanelRef.value) {
      qrCodePanelRef.value.innerHTML = '';
      await qrCode.append(qrCodePanelRef.value);
    }
  }

  async function copyLink() {
    if (!contactURL.value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(contactURL.value);

      notification.$createNotice({
        type: 'success',
        content: t('qrcode.copy-link-text'),
      });
    } catch (err) {
      notification.$createNotice({
        type: 'error',
        content: t('qrcode.copy-link-error'),
      });
      console.error('Failed to copy', err);
    }
  }

  function getWrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let currentLine = '';
    const chars = text.split('');

    for (let n = 0; n < chars.length; n++) {
      const testLine = currentLine + chars[n];
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth > maxWidth && n > 0) {
        lines.push(currentLine);
        currentLine = chars[n];
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  }

  async function downloadQRcode(contactMail?: string) {
    if (!contactMail || !qrCode) {
      return null;
    }

    try {
      const qrImg = await qrCode.getCanvas();

      const cornerRadius = 16;
      const qrCanvas = document.createElement('canvas');
      const ctx = qrCanvas.getContext('2d');
      if (!ctx) {
        return null;
      }

      qrCanvas.width = 780;
      qrCanvas.height = 900;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, qrCanvas.width, qrCanvas.height, cornerRadius);
      ctx.fill();

      // Symmetrical horizontal positioning: (780 - 760) / 2 = 10
      ctx.drawImage(qrImg, 0, 0, qrImg.width, qrImg.height, 10, 10, 760, 760);

      ctx.font = 'bold 28px Arial';
      ctx.fillStyle = selectedColor.value;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const centerText = qrCanvas.width / 2;
      const lines = getWrappedLines(ctx, contactMail, 720);
      const lineHeight = 36;
      const centerY = 835;
      const startY = centerY - ((lines.length - 1) * lineHeight) / 2;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], centerText, startY + i * lineHeight);
      }

      const blob = await new Promise<Blob | null>(resolve => qrCanvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        return null;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const qrImageU8array = new Uint8Array(arrayBuffer);

      if (!w3n.shell?.fileDialogs?.saveFileDialog) {
        return null;
      }

      const targetFile = await w3n.shell.fileDialogs.saveFileDialog(
        t('qrcode.save-dialog-title'),
        t('qrcode.save-dialog-button'),
        `QR-Code-${contactMail}.png`,
        { filters: [{ name: 'PNG Image', extensions: ['png'] }] },
      );

      if (targetFile) {
        await targetFile.writeBytes(qrImageU8array);
        notification.$createNotice({
          type: 'success',
          content: t('qrcode.save-success'),
        });
        return true;
      } else {
        return null;
      }
    } catch (error) {
      notification.$createNotice({
        type: 'error',
        content: t('qrcode.download-qr-error'),
      });
      console.error('Failed to download qr image: ', error);
    }
  }

  watch(
    () => [props.contactData?.mail, props.contactData?.name, user.value],
    () => {
      generateQRcode();
    },
  );

  onMounted(() => {
    generateQRcode();
  });
</script>

<template>
  <ui3n-dialog v-bind="dialogProps">
    <template #body>
      <div :class="$style.overallContent">
        <div ref="qrCodePanelRef" />

        <div :class="$style.contactMail">
          {{ contactData?.mail }}
        </div>
        <div
          v-if="!showColorPicker"
          :class="$style.qrAction"
        >
          <div :class="$style.saveQrbutton">
            <ui3n-tooltip
              :content="t('qrcode.save-qr-tooltip')"
              position-strategy="fixed"
              placement="top"
            >
              <ui3n-button
                type="icon"
                icon="outline-download-for-offline"
                icon-size="25"
                icon-color="var(--color-text-control-primary-default)"
                color="var(--color-bg-button-tritery-default)"
                :disabled="!contactData?.mail"
                @click="downloadQRcode(contactData?.mail)"
              />
            </ui3n-tooltip>
            <ui3n-tooltip
              :content="t('qrcode.color-qr-tooltip')"
              position-strategy="fixed"
              placement="top"
            >
              <ui3n-button
                type="icon"
                icon="outline-color-lens"
                icon-size="25"
                icon-color="var(--color-text-control-primary-default)"
                color="var(--color-bg-button-tritery-default)"
                :disabled="!contactData?.mail"
                @click="showColorPicker = true"
              />
            </ui3n-tooltip>
          </div>

          <div :class="$style.contactLink">
            <div>
              <ui3n-tooltip
                :content="t('qrcode.copy-link-tooltip')"
                position-strategy="fixed"
                placement="top"
              >
                <ui3n-button
                  type="icon"
                  icon="round-content-copy"
                  icon-size="16"
                  icon-color="var(--color-text-control-primary-default)"
                  color="var(--color-bg-button-tritery-default)"
                  :disabled="!contactURL"
                  @click="copyLink"
                />
              </ui3n-tooltip>
            </div>
            <div :class="$style.contactLinkText">
              {{ contactURL }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="showColorPicker"
        :class="$style.colorPicker"
      >
        <div :class="$style.palette">
          <div
            v-for="color in colors"
            :key="color"
            :style="{ backgroundColor: color }"
            :class="[$style.colorSwatch, selectedColor === color && $style.active]"
            @click="selectColor(color)"
          >
            <ui3n-icon
              v-if="selectedColor === color"
              icon="round-check"
              size="28"
              color="#ffffff"
            />
          </div>
        </div>
        <div :class="$style.colorButtonPanel">
          <ui3n-button @click="showColorPicker = false">
            {{ t('qrcode.color-close-panel') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .overallContent {
    position: relative;
    padding: var(--spacing-m);
    color: var(--color-text-control-primary-default);
    text-align: center;

    canvas {
      display: block;
      width: 200px;
      height: 200px;
      margin: 0 auto;
      border-radius: var(--spacing-m);
      border: 2px solid var(--color-border-block-primary-default);
    }
  }

  .contactLink {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    border-radius: 8px;
    border: 1px solid var(--color-border-block-primary-default);
    margin-top: var(--spacing-m);
    padding: var(--spacing-s);
    font-size: var(--font-12);
    text-align: left;

    .contactLinkText {
      margin-left: var(--spacing-s);
      width: 90%;
      overflow-wrap: break-word;
    }
  }

  .contactMail {
    text-align: center;
    overflow-wrap: break-word;
    margin-top: var(--spacing-s);
    font-size: var(--font-14);
  }

  .qrAction {
    margin-top: var(--spacing-m);
  }

  .saveQrbutton {
    display: flex;
    justify-content: center;
    gap: var(--spacing-s);
  }

  .colorPicker {
    padding: var(--spacing-m);
  }

  .palette {
    display: flex;
    gap: var(--spacing-m);
    margin: 0 auto;
    justify-content: center;
    flex-wrap: wrap;
    width: 250px;
  }

  .colorSwatch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--spacing-xl);
    height: var(--spacing-xl);
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid var(--color-text-control-primary-default);
    transition:
      transform 0.2s,
      border-color 0.2s;

    &:hover {
      transform: scale(1.2);
    }

    &.active {
      transform: scale(1.2);
    }
  }

  .colorButtonPanel {
    display: flex;
    justify-content: center;
    margin: var(--spacing-s);
  }
</style>
