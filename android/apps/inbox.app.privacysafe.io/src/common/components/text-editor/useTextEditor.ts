import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Squire from 'squire-rte';
import sanitizeHtml from 'sanitize-html';
import last from 'lodash/last';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { TextEditorProps, TextEditorEmits } from './types';

export function useTextEditor(props: TextEditorProps, emits: TextEditorEmits) {
  const { t } = useI18n();

  const editorEl = ref<Nullable<HTMLDivElement>>(null);
  let editor: Squire | null = null;

  const isFocused = ref(false);
  const selectionFormat = ref<Nullable<string>>(null);

  function focusEditor() {
    if (!isFocused.value) {
      editor?.focus();
      isFocused.value = true;
    }
  }

  function onBlur() {
    isFocused.value = false;
  }

  function onSelect() {
    const selection = editor!.getSelectedText();
    const path = editor!.getPath();

    if (!selection || !path) {
      selectionFormat.value = null;
    }

    if (editor!.hasFormat('ol')) {
      selectionFormat.value = 'ordered';
      return;
    }

    if (editor!.hasFormat('ul')) {
      selectionFormat.value = 'unordered';
      return;
    }

    if (
      editor!.hasFormat('div', { class: 'align-left' }) ||
      editor!.hasFormat('div', { class: ' align-left' }) ||
      editor!.hasFormat('span', { class: 'align-left' }) ||
      editor!.hasFormat('span', { class: ' align-left' })
    ) {
      selectionFormat.value = 'align-left';
      return;
    }

    if (
      editor!.hasFormat('div', { class: 'align-right' }) ||
      editor!.hasFormat('div', { class: ' align-right' }) ||
      editor!.hasFormat('span', { class: 'align-right' }) ||
      editor!.hasFormat('span', { class: ' align-right' })
    ) {
      selectionFormat.value = 'align-right';
      return;
    }

    if (
      editor!.hasFormat('div', { class: 'align-center' }) ||
      editor!.hasFormat('div', { class: ' align-center' }) ||
      editor!.hasFormat('span', { class: 'align-center' }) ||
      editor!.hasFormat('span', { class: ' align-center' })
    ) {
      selectionFormat.value = 'align-center';
      return;
    }

    if (
      editor!.hasFormat('div', { class: 'align-justify' }) ||
      editor!.hasFormat('div', { class: ' align-justify' }) ||
      editor!.hasFormat('span', { class: 'align-justify' }) ||
      editor!.hasFormat('span', { class: ' align-justify' })
    ) {
      selectionFormat.value = 'align-justify';
      return;
    }

    if (editor!.hasFormat('blockquote')) {
      selectionFormat.value = 'quote';
      return;
    }

    if (editor!.hasFormat('pre') || editor!.hasFormat('code')) {
      selectionFormat.value = 'code';
      return;
    }

    const parsedPath = path.split('>');
    const lastPathPoint = last(parsedPath);

    if (lastPathPoint === 'B') {
      selectionFormat.value = 'bold';
      return;
    }

    if (lastPathPoint === 'I') {
      selectionFormat.value = 'italic';
      return;
    }

    if (lastPathPoint === 'U') {
      selectionFormat.value = 'underline';
      return;
    }

    if (lastPathPoint === 'S') {
      selectionFormat.value = 'strikethrough';
      return;
    }

    selectionFormat.value = null;
  }

  function onInput() {
    emits('update:text', editor!.getHTML());
  }

  function setFormat(format: string) {
    switch (format) {
      case 'h1':
        editor!.changeFormat({
          tag: 'span',
          attributes: { class: 'te-font-32' },
        });
        break;
      case 'h2':
        editor!.changeFormat({
          tag: 'span',
          attributes: { class: 'te-font-24' },
        });
        break;
      case 'h3':
        editor!.changeFormat({
          tag: 'span',
          attributes: { class: 'te-font-18' },
        });
        break;
      case 'paragraph':
        editor!.changeFormat({
          tag: 'span',
          attributes: { class: 'te-font-12' },
        });
        break;
      case 'bold':
        if (selectionFormat.value === 'bold') {
          editor!.changeFormat({ tag: 'span' }, { tag: 'b' }, undefined, true);
        } else {
          editor!.changeFormat({ tag: 'span' }, { tag: 'b' }, undefined, true);
          editor!.changeFormat({ tag: 'b' }, undefined, undefined, true);
        }
        break;
      case 'italic':
        if (selectionFormat.value === 'italic') {
          editor!.changeFormat({ tag: 'span' }, { tag: 'i' }, undefined, true);
        } else {
          editor!.changeFormat({ tag: 'span' }, { tag: 'i' }, undefined, true);
          editor!.changeFormat({ tag: 'i' }, undefined, undefined, true);
        }
        break;
      case 'underline':
        if (selectionFormat.value === 'underline') {
          editor!.changeFormat({ tag: 'span' }, { tag: 'u' }, undefined, true);
        } else {
          editor!.changeFormat({ tag: 'span' }, { tag: 'u' }, undefined, true);
          editor!.changeFormat({ tag: 'u' }, undefined, undefined, true);
        }
        break;
      case 'strikethrough':
        if (selectionFormat.value === 'strikethrough') {
          editor!.changeFormat({ tag: 'span' }, { tag: 's' }, undefined, true);
        } else {
          editor!.changeFormat({ tag: 'span' }, { tag: 's' }, undefined, true);
          editor!.changeFormat({ tag: 's' }, undefined, undefined, true);
        }
        break;
      case 'ordered':
        if (selectionFormat.value === 'ordered') {
          editor!.removeList();
        } else {
          editor!.makeOrderedList();
        }
        break;
      case 'unordered':
        if (selectionFormat.value === 'unordered') {
          editor!.removeList();
        } else {
          editor!.makeUnorderedList();
        }
        break;
      case 'decreaseListLevel':
        editor!.decreaseListLevel();
        break;
      case 'increaseListLevel':
        editor!.increaseListLevel();
        break;
      case 'align-left':
        editor!.setTextAlignment('left');
        break;
      case 'align-right':
        editor!.setTextAlignment('right');
        break;
      case 'align-center':
        editor!.setTextAlignment('center');
        break;
      case 'align-justify':
        editor!.setTextAlignment('justify');
        break;
      case 'quote':
        editor!.increaseQuoteLevel();
        break;
      case 'code':
        editor!.removeAllFormatting();
        editor!.toggleCode();
        break;
    }

    onInput();
  }

  function onCursorMove() {
    selectionFormat.value = null;
  }

  onMounted(() => {
    editor = new Squire(editorEl.value!, {
      blockTag: 'div',
      sanitizeToDOMFragment(html: string) {
        const sanitizedHtml = sanitizeHtml(html, {
          allowedClasses: {
            '*': [
              'te-font-12',
              'te-font-18',
              'te-font-24',
              'te-font-32',
              'align-left',
              'align-right',
              'align-center',
              'align-justify',
            ],
          },
        });

        const doc = new DOMParser().parseFromString(sanitizedHtml, 'text/html');
        const frag = doc.createDocumentFragment();
        const body = doc.body;
        while (body.firstChild) {
          frag.appendChild(body.firstChild);
        }
        return document.importNode(frag, true);
      },
    });

    editor.addEventListener('input', onInput);
    editor.addEventListener('focus', focusEditor);
    editor.addEventListener('blur', onBlur);
    editor.addEventListener('select', onSelect);
    editor.addEventListener('cursor', onCursorMove);

    if (props.text) {
      editor.setHTML(props.text);
    }

    if (props.autofocus) {
      setTimeout(() => {
        editor?.focus();
      }, 50);
    }

    emits('init', editor);
  });

  onBeforeUnmount(() => {
    if (editor) {
      editor.removeEventListener('input', onInput);
      editor.removeEventListener('focus', focusEditor);
      editor.removeEventListener('blur', onBlur);
      editor.removeEventListener('select', onSelect);
      editor.removeEventListener('cursor', onCursorMove);
      editor.destroy();
    }
  });

  watch(
    () => props.text,
    () => {
      editor && editor.setHTML(props.text || '');
    },
  );

  return {
    t,
    editorEl,
    editor,
    isFocused,
    selectionFormat,
    focusEditor,
    setFormat,
  };
}
