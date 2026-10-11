<!--
 Copyright (C) 2025 3NSoft Inc.

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
  import { Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import type { TextEditorProps, TextEditorEmits } from './types';
  import { useTextEditor } from './useTextEditor';
  import ToolbarButton from './text-editor-toolbar-button.vue';

  const props = defineProps<TextEditorProps>();
  const emits = defineEmits<TextEditorEmits>();

  const { t, editorEl, isFocused, selectionFormat, focusEditor, setFormat } = useTextEditor(props, emits);
</script>

<template>
  <div :class="[$style.editor, disabled && $style.editorDisabled]">
    <div :class="[$style.toolbarWrapper, !showToolbar && $style.toolbarWrapperHidden]">
      <div :class="$style.toolbar">
        <span :class="$style.toolbarBlock">
          <ui3n-menu position-strategy="fixed">
            <toolbar-button
              icon="round-format-size"
              prepend-icon="round-unfold-more"
              :tooltip="t('msg.content.editor.fontSize')"
            />

            <template #menu>
              <div :class="$style.fontSizeMenu">
                <div
                  :class="$style.menuItem"
                  @click="setFormat('h1')"
                >
                  <ui3n-icon
                    icon="heading-h1"
                    width="18"
                    height="18"
                  />

                  <span>{{ t('msg.content.editor.fontSize_header') }} 1</span>
                </div>

                <div
                  :class="$style.menuItem"
                  @click="setFormat('h2')"
                >
                  <ui3n-icon
                    icon="heading-h2"
                    width="18"
                    height="18"
                  />

                  <span>{{ t('msg.content.editor.fontSize_header') }} 2</span>
                </div>

                <div
                  :class="$style.menuItem"
                  @click="setFormat('h3')"
                >
                  <ui3n-icon
                    icon="heading-h3"
                    width="18"
                    height="18"
                  />

                  <span>{{ t('msg.content.editor.fontSize_header') }} 3</span>
                </div>

                <div
                  :class="$style.menuItem"
                  @click="setFormat('paragraph')"
                >
                  <span>{{ t('msg.content.editor.fontSize_normal') }}</span>
                </div>
              </div>
            </template>
          </ui3n-menu>
        </span>

        <span :class="$style.toolbarBlock">
          <toolbar-button
            icon="round-format-bold"
            :tooltip="selectionFormat === 'bold' ? t('msg.content.editor.unbold') : t('msg.content.editor.bold')"
            :is-active="selectionFormat === 'bold'"
            @click.stop.prevent="setFormat('bold')"
          />

          <toolbar-button
            icon="round-format-italic"
            :tooltip="
              selectionFormat === 'italic' ? t('msg.content.editor.noItalic') : t('msg.content.editor.italic')
            "
            :is-active="selectionFormat === 'italic'"
            @click.stop.prevent="setFormat('italic')"
          />

          <toolbar-button
            icon="round-format-underlined"
            :tooltip="
              selectionFormat === 'underline'
                ? t('msg.content.editor.noUnderline')
                : t('msg.content.editor.underline')
            "
            :is-active="selectionFormat === 'underline'"
            @click.stop.prevent="setFormat('underline')"
          />

          <toolbar-button
            icon="round-strikethrough"
            :tooltip="
              selectionFormat === 'strikethrough'
                ? t('msg.content.editor.noStrikethrough')
                : t('msg.content.editor.strikethrough')
            "
            :is-active="selectionFormat === 'strikethrough'"
            @click.stop.prevent="setFormat('strikethrough')"
          />
        </span>

        <span :class="$style.toolbarBlock">
          <toolbar-button
            icon="round-format-list-numbered"
            :tooltip="
              selectionFormat === 'ordered' ? t('msg.content.editor.noList') : t('msg.content.editor.ordered')
            "
            :is-active="selectionFormat === 'ordered'"
            @click.stop.prevent="setFormat('ordered')"
          />

          <toolbar-button
            icon="round-format-list-bulleted"
            :tooltip="
              selectionFormat === 'unordered' ? t('msg.content.editor.noList') : t('msg.content.editor.unordered')
            "
            :is-active="selectionFormat === 'unordered'"
            @click.stop.prevent="setFormat('unordered')"
          />

          <toolbar-button
            icon="round-format-indent-decrease"
            :tooltip="t('msg.content.editor.decreaseListLevel')"
            @click.stop.prevent="setFormat('decreaseListLevel')"
          />

          <toolbar-button
            icon="round-format-indent-increase"
            :tooltip="t('msg.content.editor.increaseListLevel')"
            @click.stop.prevent="setFormat('increaseListLevel')"
          />
        </span>

        <span :class="$style.toolbarBlock">
          <toolbar-button
            icon="round-format-align-left"
            :tooltip="t('msg.content.editor.align_left')"
            :is-active="selectionFormat === 'align-left'"
            @click.stop.prevent="setFormat('align-left')"
          />

          <toolbar-button
            icon="round-format-align-right"
            :tooltip="t('msg.content.editor.align_right')"
            :is-active="selectionFormat === 'align-right'"
            @click.stop.prevent="setFormat('align-right')"
          />

          <toolbar-button
            icon="round-format-align-center"
            :tooltip="t('msg.content.editor.align_center')"
            :is-active="selectionFormat === 'align-center'"
            @click.stop.prevent="setFormat('align-center')"
          />

          <toolbar-button
            icon="round-format-align-justify"
            :tooltip="t('msg.content.editor.align_justify')"
            :is-active="selectionFormat === 'align-justify'"
            @click.stop.prevent="setFormat('align-justify')"
          />
        </span>

        <span :class="$style.toolbarBlock">
          <toolbar-button
            icon="round-format-quote"
            :tooltip="t('msg.content.editor.quote')"
            :is-active="selectionFormat === 'quote'"
            @click.stop.prevent="setFormat('quote')"
          />

          <toolbar-button
            icon="round-code"
            :tooltip="selectionFormat === 'code' ? t('msg.content.editor.noCode') : t('msg.content.editor.code')"
            :is-active="selectionFormat === 'code'"
            @click.stop.prevent="setFormat('code')"
          />
        </span>
      </div>
    </div>

    <div
      tabindex="0"
      :class="[$style.editorBody, isFocused && $style.editorBodyFocused, disabled && $style.editorBodyDisabled]"
      @focus.stop.prevent="focusEditor"
    >
      <div
        ref="editorEl"
        :class="$style.editorContent"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .editor {
    position: relative;
    width: 100%;
    min-height: var(--spacing-xxl);
    padding: var(--spacing-m);
    flex-grow: 1;
    display: flex;
    flex-direction: column;

    &.editorDisabled {
      padding: 0;
      pointer-events: none;
    }
  }

  .toolbarWrapper {
    position: relative;
    width: 100%;
    height: var(--spacing-xl);
    padding-bottom: var(--spacing-m);
    opacity: 1;
    transition: all ease-in-out 0.2s;

    &.toolbarWrapperHidden {
      height: 0;
      padding-bottom: 0;
      opacity: 0;
      transition: all ease-in-out 0.2s;
    }
  }

  .toolbar {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .toolbarBlock {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: 2px;
  }

  .fontSizeMenu {
    position: relative;
    width: 96px;
    padding: var(--spacing-xs) 0;
    background-color: var(--color-bg-control-secondary);
  }

  .menuItem {
    position: relative;
    width: 100%;
    height: var(--spacing-ml);
    padding: 0 var(--spacing-s);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-13);
    color: var(--color-text-control-primary-default);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
    }
  }

  .editorBody {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-xs);
    padding: var(--spacing-s);
    flex-grow: 1;
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-chat-bubble-other-default);

    &.editorBodyDisabled {
      background-color: transparent;
    }

    &:not(.editorBodyDisabled).editorBodyFocused {
      outline: 1px solid var(--color-border-control-accent-focused);
    }
  }

  .editorContent {
    min-height: var(--spacing-l);
    outline: none;
    line-height: 1.3;

    ol,
    ul {
      margin: 0;
      padding-inline-start: var(--spacing-ml);
    }

    code,
    pre {
      display: block;
      position: relative;
      padding: var(--spacing-s) 12px;
      border-radius: var(--spacing-xs);
      white-space: pre-wrap;
      background-color: var(--color-bg-block-tritery-default);
      color: var(--warning-content-default);
    }

    blockquote {
      --blockquote-padding: 6px 6px 6px 16px;

      position: relative;
      margin: var(--spacing-s) 0;
      border-radius: var(--spacing-xs);
      background-color: var(--color-bg-chat-bubble-other-quote);
      padding: var(--blockquote-padding);

      &:before {
        content: '';
        position: absolute;
        left: 7px;
        top: 6px;
        bottom: 6px;
        width: 2px;
        border-radius: 2px;
        background-color: var(--color-icon-chat-bubble-user-quote);
      }
    }

    :global(.te-font-12) {
      font-size: 12px;
    }

    :global(.te-font-18) {
      font-size: 18px;
    }

    :global(.te-font-24) {
      font-size: 24px;
    }

    :global(.te-font-32) {
      font-size: 32px;
    }

    :global(.align-left) {
      text-align: left;
    }

    :global(.align-right) {
      text-align: right;
    }

    :global(.align-center) {
      text-align: center;
    }

    :global(.align-justify) {
      text-align: justify;
    }
  }
</style>
