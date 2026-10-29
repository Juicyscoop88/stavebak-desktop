import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, useEditorState, Extension, type Editor } from '@tiptap/react';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BubbleMenu } from '@tiptap/react/menus';
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
  'Otevřené otázky': 'Co je potřeba vyřešit. Tlačítkem Úkoly uděláte seznam k odškrtnutí.',
};

/**
 * Grey hint under a heading that has nothing written below it yet. A decoration, not content: the empty
 * line is not in the file (Markdown drops empty paragraphs, so a placeholder paragraph would never show).
 * Clicking the hint opens a real line under the heading.
 */
const SectionHints = Extension.create({
  name: 'sectionHints',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const decorations: Decoration[] = [];
            doc.forEach((node, offset, index) => {
              if (node.type.name !== 'heading') return;
              const next = index + 1 < doc.childCount ? doc.child(index + 1) : null;
              const hint = SECTION_HINTS[node.textContent];
              if (!hint) return;
              const end = offset + node.nodeSize;
              // The editor appends an empty line after a last heading: the hint sits on that line
              if (next && next.type.name === 'paragraph' && next.content.size === 0) {
                decorations.push(Decoration.node(end, end + next.nodeSize, { class: 'notes-hint-line', 'data-hint': hint }));
                return;
              }
              if (next && next.type.name !== 'heading') return;
              decorations.push(Decoration.widget(end, (view) => {
                const el = document.createElement('div');
                el.className = 'notes-hint';
                el.textContent = hint;
                el.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const paragraph = state.schema.nodes.paragraph.create();
                  const tr = state.tr.insert(end, paragraph);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)));
                  view.dispatch(tr.scrollIntoView());
                  view.focus();
                });
                return el;
              }, { side: -1, key: `hint-${end}-${hint}` }));
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

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
      SectionHints,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false, transformPastedText: true }),
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ editor: ed, node, pos }) => {
          if (node.type.name === 'heading') return 'Nadpis';
          const before = pos > 0 ? ed.state.doc.resolve(pos).nodeBefore : null;
          // Hints under template headings are drawn by SectionHints, so the line itself stays quiet
          if (before?.type.name === 'heading' && SECTION_HINTS[before.textContent]) return '';
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
      {editor && <SelectionMenu editor={editor} />}
      <div className="flex-1 min-h-0 overflow-y-auto" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} className="max-w-2xl mx-auto px-6 py-5" />
      </div>
    </div>
  );
}

/** tiptap-markdown keeps the serializer in the editor's storage. */
function markdownOf(editor: Editor): string {
  return tightenTaskLists((editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown());
}

/** The serializer writes task lists loose (blank line between items); keep them as compact as bullets. */
export function tightenTaskLists(markdown: string): string {
  return markdown.replace(/^(- \[[ xX]\] .*)\n\n(?=- \[[ xX]\] )/gm, '$1\n');
}

/** List buttons never turn a heading into a bullet: from a heading they start the list on a new line below it. */
function toggleBlock(editor: Editor, list: 'bulletList' | 'taskList') {
  const { $from } = editor.state.selection;
  const chain = editor.chain().focus();
  if ($from.parent.type.name === 'heading') {
    const after = $from.after($from.depth);
    chain.insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1);
  }
  (list === 'bulletList' ? chain.toggleBulletList() : chain.toggleTaskList()).run();
}

/** What the selection covers: decides which buttons would actually do something. */
function selectionFacts(ed: Editor) {
  const { from, to, empty } = ed.state.selection;
  let headings = 0;
  let others = 0;
  ed.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    if (node.type.name === 'heading') headings++;
    else others++;
  });
  return { empty, headingOnly: headings > 0 && others === 0, spansHeading: !empty && headings > 0 };
}

const NO_LIST_ON_HEADING = 'Seznam jde udělat jen z běžného textu. Označte text pod nadpisem, nebo klikněte do nadpisu a seznam se založí pod ním.';
const HEADING_IS_BOLD = 'Nadpisy jsou už tučné.';

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      heading: ed.isActive('heading'),
      bold: ed.isActive('bold'),
      highlight: ed.isActive('highlight'),
      bullet: ed.isActive('bulletList'),
      task: ed.isActive('taskList'),
      ...selectionFacts(ed),
    }),
  });
  const buttons: { icon: Icon; label: string; title: string; active: boolean; disabledWhy?: string; run: () => void }[] = [
    { icon: TextHTwo, label: 'Nadpis', title: 'Udělá z řádku nadpis (nebo zpět běžný text)', active: state.heading, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: TextB, label: 'Tučně', title: 'Tučné písmo (⌘B)', active: state.bold, disabledWhy: state.headingOnly ? HEADING_IS_BOLD : undefined, run: () => editor.chain().focus().toggleBold().run() },
    { icon: Highlighter, label: 'Zvýraznit', title: 'Označí vybraný text barvou', active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
    { icon: ListBullets, label: 'Odrážky', title: 'Seznam s odrážkami', active: state.bullet, disabledWhy: state.spansHeading ? NO_LIST_ON_HEADING : undefined, run: () => toggleBlock(editor, 'bulletList') },
    { icon: ListChecks, label: 'Úkoly', title: 'Seznam úkolů k odškrtnutí', active: state.task, disabledWhy: state.spansHeading ? NO_LIST_ON_HEADING : undefined, run: () => toggleBlock(editor, 'taskList') },
  ];
  return (
    <div className="flex-shrink-0 flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-border-subtle">
      {buttons.map(({ icon: Icon, label, title, active, disabledWhy, run }) => (
        <button key={label} title={disabledWhy ?? title} aria-pressed={active} aria-disabled={!!disabledWhy}
          onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!disabledWhy) run(); }}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-smooth
            ${disabledWhy ? 'text-text-tertiary opacity-40 cursor-not-allowed'
              : active ? 'bg-bg-tertiary text-text-primary cursor-pointer'
                : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary cursor-pointer'}`}>
          <Icon size={16} weight={active ? 'bold' : 'regular'} />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Small menu that floats over selected text: the formatting you want is right where you are reading. */
function SelectionMenu({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({ bold: ed.isActive('bold'), highlight: ed.isActive('highlight'), ...selectionFacts(ed) }),
  });
  const items = [
    ...(state.headingOnly ? [] : [{ icon: TextB, label: 'Tučně', active: state.bold, run: () => editor.chain().focus().toggleBold().run() }]),
    { icon: Highlighter, label: 'Zvýraznit', active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
  ];
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: ed, state: st }) => ed.isEditable && !st.selection.empty && ed.isFocused}
      className="flex items-center gap-0.5 p-1 rounded-xl border border-border bg-bg-card shadow-lg"
    >
      {items.map(({ icon: Icon, label, active, run }) => (
        <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={run}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs cursor-pointer transition-smooth
            ${active ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'}`}>
          <Icon size={14} weight={active ? 'bold' : 'regular'} />
          {label}
        </button>
      ))}
    </BubbleMenu>
  );
}
