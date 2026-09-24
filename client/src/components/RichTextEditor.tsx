import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

// A real editable-document editor (TipTap/ProseMirror), not a textarea with
// Markdown-insert buttons; that approach couldn't handle basic things like
// continuing a bulleted list on Enter, since it had no real concept of
// "list item" at all, just text with dashes in it. This gives correct list
// continuation, live formatting, and proper HTML output for free.
interface RichTextEditorProps {
  placeholder?: string;
  onUpdate: (html: string, text: string) => void;
  autoFocus?: boolean;
}

function ToolbarButton({
  active,
  onClick,
  title,
  className = '',
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm font-semibold ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ placeholder, onUpdate, autoFocus }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    autofocus: autoFocus ?? false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-invert max-w-none min-h-[120px] focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => onUpdate(editor.getHTML(), editor.getText()),
  });

  if (!editor) return null;

  function setLink() {
    const previousUrl = editor?.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
        <ToolbarButton
          active={editor.isActive('bold')}
          title="Bold"
          className="font-bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('italic')}
          title="Italic"
          className="italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('strike')}
          title="Strikethrough"
          className="line-through"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          S
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          active={editor.isActive('bulletList')}
          title="Bulleted list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('orderedList')}
          title="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('blockquote')}
          title="Quote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={editor.isActive('link')} title="Link" onClick={setLink}>
          Link
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
    </div>
  );
}
