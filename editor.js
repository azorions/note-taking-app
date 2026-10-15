import { Editor, Mark, mergeAttributes, Node } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { title: { default: 'Toggle heading' } };
  },
  parseHTML() {
    return [{
      tag: 'details',
      getAttrs: (element) => ({ title: element.querySelector('summary')?.textContent?.trim() || 'Toggle heading' }),
      contentElement: (element) => {
        const wrapper = document.createElement('div');
        [...element.childNodes].filter((child) => !(child.nodeType === 1 && child.nodeName === 'SUMMARY'))
          .forEach((child) => wrapper.append(child.cloneNode(true)));
        return wrapper;
      }
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes), ['summary', {}, node.attrs.title], ['div', {}, 0]];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const content = document.createElement('div');
      summary.contentEditable = 'true';
      summary.textContent = node.attrs.title;
      content.className = 'toggle-content';
      details.append(summary, content);
      summary.addEventListener('input', () => {
        if (typeof getPos !== 'function') return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, title: summary.textContent.trim() || 'Toggle heading' }));
      });
      return {
        dom: details,
        contentDOM: content,
        stopEvent: (event) => summary.contains(event.target),
        ignoreMutation: (mutation) => mutation.target === details || summary.contains(mutation.target),
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          if (summary.textContent !== updatedNode.attrs.title) summary.textContent = updatedNode.attrs.title;
          node = updatedNode;
          return true;
        }
      };
    };
  }
});

const PageReference = Node.create({
  name: 'pageReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  addAttributes() {
    return { page: { default: 1, parseHTML: (element) => Number(element.getAttribute('data-page')) || 1 } };
  },
  parseHTML() {
    return [{ tag: 'button.page-ref[data-page]' }, { tag: 'a.page-ref[data-page]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const page = Math.max(1, Number(node.attrs.page) || 1);
    return ['button', mergeAttributes(HTMLAttributes, { type: 'button', class: 'page-ref', 'data-page': String(page) }), `↗ Page ${page} in PDF`];
  }
});

const Underline = Mark.create({
  name: 'underline',
  parseHTML() { return [{ tag: 'u' }, { style: 'text-decoration=underline' }]; },
  renderHTML({ HTMLAttributes }) { return ['u', mergeAttributes(HTMLAttributes), 0]; }
});

export function createNoteEditor({ element, content, ydoc = null, onUpdate, onSelectionUpdate }) {
  const extensions = [
    StarterKit.configure({ undoRedo: ydoc ? false : undefined }),
    Image.configure({ allowBase64: true }),
    TaskList.configure({ HTMLAttributes: { class: 'task-list' } }),
    TaskItem.configure({ nested: true }),
    ToggleBlock,
    PageReference,
    Underline
  ];
  if (ydoc) extensions.push(Collaboration.configure({ document: ydoc, field: 'default' }));
  return new Editor({
    element,
    extensions,
    content: ydoc ? undefined : (content || '<p></p>'),
    editorProps: { attributes: { class: 'tiptap-content' } },
    onUpdate,
    onSelectionUpdate
  });
}

export function insertImageAtCursor(editor, source, alt = 'Pasted image') {
  if (!editor || !source) return false;
  editor.chain().focus().setImage({ src: source, alt }).run();
  return true;
}

export { ToggleBlock, PageReference };
