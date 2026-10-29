import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { TextHTwo, TextB, Highlighter, ListBullets, ListChecks } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

/** What to write under a template heading; shown in the empty line below it. */
const SECTION_HINTS: Record<string, string> = {
  'Přání investora': 'Dispozice, materiály, vytápění, rozpočet, termíny…',
  'Dohody z jednání': 'S kým, kdy a na čem jste se dohodli: úřad, dotčené orgány, správci sítí, sousedé…',
  'Zvyklosti kanceláře': 'Pojmenování výkresů, kdo podepisuje, s jakými dodavateli průzkumů pracujete…',
  'Otevřené otázky': 'Co je potřeba vyřešit. Zaškrtávátko vložíte přes [ ] na začátku řádku.',
};

/**
 * Project notes (CLAUDE.md) as plain writing: one calm column, headings, bold, highlight, lists, tasks.
 * The file stays Markdown, so the assistant reads it as before.
 */
export function NotesEditor({ content, onChange }: { content: string; onChange: (markdown: string) => void }) {
  const lastEmitted = useRef(content);
  // True while the file's content is being put into the editor: such changes are never saved back
  const applying = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false, transformPastedText: true }),
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ editor: ed, node, pos }) => {
          if (node.type.name === 'heading') return 'Nadpis';
          const before = pos > 0 ? ed.state.doc.resolve(pos).nodeBefore : null;
          if (before?.type.name === 'heading') return SECTION_HINTS[before.textContent] ?? 'Pište…';
          return 'Pište…';
        },
      }),
    ],
    content,
    autofocus: 'end',
    onUpdate: ({ editor: ed }) => {
      // Editor housekeeping (e.g. the trailing empty line appended after loading) is not an edit
      if (applying.current) return;
      const markdown = markdownOf(ed);
      if (markdown === lastEmitted.current) return;
      // Never blank out notes unless the person is actually writing here
      if (!markdown.trim() && lastEmitted.current.trim() && !ed.isFocused) return;
      lastEmitted.current = markdown;
      onChange(markdown);
    },
  });

  // The file changed outside (the assistant wrote to it): show it, unless it is our own write coming back
  useEffect(() => {
    if (!editor || content === lastEmitted.current) return;
    lastEmitted.current = content;
    applying.current = true;
    try {
      editor.commands.setContent(content, { emitUpdate: false });
    } finally {
      applying.current = false;
    }
  }, [editor, content]);

  return (
    <div className="notes-editor flex flex-col h-full">
      {editor && <Toolbar editor={editor} />}
      <div className="flex-1 min-h-0 overflow-y-auto" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} className="max-w-2xl mx-auto px-6 py-5" />
      </div>
    </div>
  );
}

/** tiptap-markdown keeps the serializer in the editor's storage. */
function markdownOf(editor: Editor): string {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      heading: ed.isActive('heading'),
      bold: ed.isActive('bold'),
      highlight: ed.isActive('highlight'),
      bullet: ed.isActive('bulletList'),
      task: ed.isActive('taskList'),
    }),
  });
  const buttons: { icon: Icon; title: string; active: boolean; run: () => void }[] = [
    { icon: TextHTwo, title: 'Nadpis', active: state.heading, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: TextB, title: 'Tučně (⌘B)', active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { icon: Highlighter, title: 'Zvýraznit', active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
    { icon: ListBullets, title: 'Odrážky', active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListChecks, title: 'Úkoly k odškrtnutí', active: state.task, run: () => editor.chain().focus().toggleTaskList().run() },
  ];
  return (
    <div className="flex-shrink-0 flex items-center justify-center gap-0.5 py-1.5 border-b border-border-subtle">
      {buttons.map(({ icon: Icon, title, active, run }) => (
        <button key={title} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}
          className={`p-1.5 rounded-lg cursor-pointer
            ${active ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary'}`}>
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
