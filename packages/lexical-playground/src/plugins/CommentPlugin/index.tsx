/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type {Provider} from '@lexical/yjs';
import type {
  EditorState,
  LexicalCommand,
  LexicalEditor,
  NodeKey,
  RangeSelection,
} from 'lexical';
import type {Doc} from 'yjs';

import './index.css';

import {
  $createMarkNode,
  $getMarkIDs,
  $isMarkNode,
  $wrapSelectionInMarkNode,
  MarkNode,
} from '@lexical/mark';
import {AutoFocusPlugin} from '@lexical/react/LexicalAutoFocusPlugin';
import {ClearEditorPlugin} from '@lexical/react/LexicalClearEditorPlugin';
import {useCollaborationContext} from '@lexical/react/LexicalCollaborationContext';
import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {EditorRefPlugin} from '@lexical/react/LexicalEditorRefPlugin';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {OnChangePlugin} from '@lexical/react/LexicalOnChangePlugin';
import {PlainTextPlugin} from '@lexical/react/LexicalPlainTextPlugin';
import {createDOMRange, createRectsFromDOMRange} from '@lexical/selection';
import {$isRootTextContentEmpty, $rootTextContent} from '@lexical/text';
import {mergeRegister, registerNestedElementResolver} from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as React from 'react';
import {createPortal} from 'react-dom';
import useLayoutEffect from 'shared/useLayoutEffect';

import {
  Comment,
  // Comments,
  CommentStore,
  createComment,
  createThread,
  Thread,
} from '../../commenting';
// import useModal from '../../hooks/useModal';
import CommentEditorTheme from '../../themes/CommentEditorTheme';
import ContentEditable from '../../ui/ContentEditable';

export const INSERT_INLINE_COMMAND: LexicalCommand<void> = createCommand(
  'INSERT_INLINE_COMMAND',
);

function AddCommentBox({
  anchorKey,
  editor,
  onAddComment,
}: {
  anchorKey: NodeKey;
  editor: LexicalEditor;
  onAddComment: () => void;
}): JSX.Element {
  return (
    <div className="CommentPlugin_AddCommentBox">
      <button
        className="CommentPlugin_AddCommentBox_button"
        onClick={onAddComment}>
        add coment
      </button>
    </div>
  );
}

function EscapeHandlerPlugin({
  onEscape,
}: {
  onEscape: (e: KeyboardEvent) => boolean;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent) => {
        return onEscape(event);
      },
      2,
    );
  }, [editor, onEscape]);

  return null;
}

function PlainTextEditor({
  className,
  autoFocus,
  onEscape,
  onChange,
  editorRef,
  placeholder = 'Type a comment...',
}: {
  autoFocus?: boolean;
  className?: string;
  editorRef?: {current: null | LexicalEditor};
  onChange: (editorState: EditorState, editor: LexicalEditor) => void;
  onEscape: (e: KeyboardEvent) => boolean;
  placeholder?: string;
}) {
  const initialConfig = {
    namespace: 'Commenting',
    nodes: [],
    onError: (error: Error) => {
      throw error;
    },
    theme: CommentEditorTheme,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="CommentPlugin_CommentInputBox_EditorContainer">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable placeholder={placeholder} className={className} />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={onChange} />
        <HistoryPlugin />
        {autoFocus !== false && <AutoFocusPlugin />}
        <EscapeHandlerPlugin onEscape={onEscape} />
        <ClearEditorPlugin />
        {editorRef !== undefined && <EditorRefPlugin editorRef={editorRef} />}
      </div>
    </LexicalComposer>
  );
}

function useOnChange(
  setContent: (text: string) => void,
  setCanSubmit: (canSubmit: boolean) => void,
) {
  return useCallback(
    (editorState: EditorState, _editor: LexicalEditor) => {
      editorState.read(() => {
        setContent($rootTextContent());
        setCanSubmit(!$isRootTextContentEmpty(_editor.isComposing(), true));
      });
    },
    [setCanSubmit, setContent],
  );
}

function CommentInputBox({
  editor,
  cancelAddComment,
  submitAddComment,
}: {
  cancelAddComment: () => void;
  editor: LexicalEditor;
  submitAddComment: (
    commentOrThread: Comment | Thread,
    isInlineComment: boolean,
    thread?: Thread,
    selection?: RangeSelection | null,
  ) => void;
}) {
  const [content, setContent] = useState('');
  const [canSubmit, setCanSubmit] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const selectionState = useMemo(
    () => ({
      container: document.createElement('div'),
      elements: [],
    }),
    [],
  );
  const selectionRef = useRef<RangeSelection | null>(null);
  const author = useCollabAuthorName();

  const updateLocation = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if ($isRangeSelection(selection)) {
        selectionRef.current = selection.clone();
        const anchor = selection.anchor;
        const focus = selection.focus;
        const range = createDOMRange(
          editor,
          anchor.getNode(),
          anchor.offset,
          focus.getNode(),
          focus.offset,
        );
        const boxElem = boxRef.current;
        if (range !== null && boxElem !== null) {
          const {left, bottom, width} = range.getBoundingClientRect();
          const selectionRects = createRectsFromDOMRange(editor, range);
          let correctedLeft =
            selectionRects.length === 1 ? left + width / 2 - 125 : left - 125;
          if (correctedLeft < 10) {
            correctedLeft = 10;
          }
          boxElem.style.left = `${correctedLeft}px`;
          boxElem.style.top = `${
            bottom +
            20 +
            (window.pageYOffset || document.documentElement.scrollTop)
          }px`;
          const selectionRectsLength = selectionRects.length;
          const {container} = selectionState;
          const elements: Array<HTMLSpanElement> = selectionState.elements;
          const elementsLength = elements.length;

          for (let i = 0; i < selectionRectsLength; i++) {
            const selectionRect = selectionRects[i];
            let elem: HTMLSpanElement = elements[i];
            if (elem === undefined) {
              elem = document.createElement('span');
              elements[i] = elem;
              container.appendChild(elem);
            }
            const color = '255, 212, 0';
            const style = `position:absolute;top:${
              selectionRect.top +
              (window.pageYOffset || document.documentElement.scrollTop)
            }px;left:${selectionRect.left}px;height:${
              selectionRect.height
            }px;width:${
              selectionRect.width
            }px;background-color:rgba(${color}, 0.3);pointer-events:none;z-index:5;`;
            elem.style.cssText = style;
          }
          for (let i = elementsLength - 1; i >= selectionRectsLength; i--) {
            const elem = elements[i];
            container.removeChild(elem);
            elements.pop();
          }
        }
      }
    });
  }, [editor, selectionState]);

  useLayoutEffect(() => {
    updateLocation();
    const container = selectionState.container;
    const body = document.body;
    if (body !== null) {
      body.appendChild(container);
      return () => {
        body.removeChild(container);
      };
    }
  }, [selectionState.container, updateLocation]);

  useEffect(() => {
    window.addEventListener('resize', updateLocation);

    return () => {
      window.removeEventListener('resize', updateLocation);
    };
  }, [updateLocation]);

  const onEscape = (event: KeyboardEvent): boolean => {
    event.preventDefault();
    cancelAddComment();
    return true;
  };

  const submitComment = () => {
    if (canSubmit) {
      let quote = editor.getEditorState().read(() => {
        const selection = selectionRef.current;
        return selection ? selection.getTextContent() : '';
      });
      if (quote.length > 100) {
        quote = quote.slice(0, 99) + '…';
      }
      submitAddComment(
        createThread(quote, [createComment(content, author)]),
        true,
        undefined,
        selectionRef.current,
      );
      selectionRef.current = null;
    }
  };

  const onChange = useOnChange(setContent, setCanSubmit);

  return (
    <div className="CommentPlugin_CommentInputBox" ref={boxRef}>
      <PlainTextEditor
        className="CommentPlugin_CommentInputBox_Editor"
        onEscape={onEscape}
        onChange={onChange}
      />
      <div className="CommentPlugin_CommentInputBox_Buttons">
        <button
          onClick={cancelAddComment}
          className="CommentPlugin_CommentInputBox_Button">
          Cancel
        </button>
        <button
          onClick={submitComment}
          disabled={!canSubmit}
          className="CommentPlugin_CommentInputBox_Button primary">
          Comment
        </button>
      </div>
    </div>
  );
}

function useCollabAuthorName(): string {
  const collabContext = useCollaborationContext();
  const {yjsDocMap, name} = collabContext;
  return yjsDocMap.has('comments') ? name : 'Playground User';
}

export default function CommentPlugin({
  providerFactory,
}: {
  providerFactory?: (id: string, yjsDocMap: Map<string, Doc>) => Provider;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commentStore = useMemo(() => new CommentStore(editor), [editor]);
  // const comments = useCommentStore(commentStore);
  const markNodeMap = useMemo<Map<string, Set<NodeKey>>>(() => {
    return new Map();
  }, []);
  const [activeAnchorKey, setActiveAnchorKey] = useState<NodeKey | null>();
  const [activeIDs, setActiveIDs] = useState<Array<string>>([]);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [, setShowComments] = useState(false);

  const cancelAddComment = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      // Restore selection
      if (selection !== null) {
        selection.dirty = true;
      }
    });
    setShowCommentInput(false);
  }, [editor]);

  const submitAddComment = useCallback(
    (
      commentOrThread: Comment | Thread,
      isInlineComment: boolean,
      thread?: Thread,
      selection?: RangeSelection | null,
    ) => {
      commentStore.addComment(commentOrThread, thread);
      if (isInlineComment) {
        editor.update(() => {
          if ($isRangeSelection(selection)) {
            const isBackward = selection.isBackward();
            const id = commentOrThread.id;

            // Wrap content in a MarkNode
            $wrapSelectionInMarkNode(selection, isBackward, id);
          }
        });
      }
    },
    [commentStore, editor],
  );

  useEffect(() => {
    const changedElems: Array<HTMLElement> = [];
    for (let i = 0; i < activeIDs.length; i++) {
      const id = activeIDs[i];
      const keys = markNodeMap.get(id);
      if (keys !== undefined) {
        for (const key of keys) {
          const elem = editor.getElementByKey(key);
          if (elem !== null) {
            elem.classList.add('selected');
            changedElems.push(elem);
            setShowComments(true);
          }
        }
      }
    }
    return () => {
      for (let i = 0; i < changedElems.length; i++) {
        const changedElem = changedElems[i];
        changedElem.classList.remove('selected');
      }
    };
  }, [activeIDs, editor, markNodeMap]);

  useEffect(() => {
    const markNodeKeysToIDs: Map<NodeKey, Array<string>> = new Map();

    return mergeRegister(
      registerNestedElementResolver<MarkNode>(
        editor,
        MarkNode,
        (from: MarkNode) => {
          return $createMarkNode(from.getIDs());
        },
        (from: MarkNode, to: MarkNode) => {
          // Merge the IDs
          const ids = from.getIDs();
          ids.forEach((id) => {
            to.addID(id);
          });
        },
      ),
      editor.registerMutationListener(
        MarkNode,
        (mutations) => {
          editor.getEditorState().read(() => {
            for (const [key, mutation] of mutations) {
              const node: null | MarkNode = $getNodeByKey(key);
              let ids: NodeKey[] = [];

              if (mutation === 'destroyed') {
                ids = markNodeKeysToIDs.get(key) || [];
              } else if ($isMarkNode(node)) {
                ids = node.getIDs();
              }

              for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                let markNodeKeys = markNodeMap.get(id);
                markNodeKeysToIDs.set(key, ids);

                if (mutation === 'destroyed') {
                  if (markNodeKeys !== undefined) {
                    markNodeKeys.delete(key);
                    if (markNodeKeys.size === 0) {
                      markNodeMap.delete(id);
                    }
                  }
                } else {
                  if (markNodeKeys === undefined) {
                    markNodeKeys = new Set();
                    markNodeMap.set(id, markNodeKeys);
                  }
                  if (!markNodeKeys.has(key)) {
                    markNodeKeys.add(key);
                  }
                }
              }
            }
          });
        },
        {skipInitialization: false},
      ),
      editor.registerUpdateListener(({editorState, tags}) => {
        editorState.read(() => {
          const selection = $getSelection();
          let hasActiveIds = false;
          let hasAnchorKey = false;

          if ($isRangeSelection(selection)) {
            const anchorNode = selection.anchor.getNode();

            if ($isTextNode(anchorNode)) {
              const commentIDs = $getMarkIDs(
                anchorNode,
                selection.anchor.offset,
              );
              if (commentIDs !== null) {
                setActiveIDs(commentIDs);
                hasActiveIds = true;
              }
              if (!selection.isCollapsed()) {
                setActiveAnchorKey(anchorNode.getKey());
                hasAnchorKey = true;
              }
            }
          }
          if (!hasActiveIds) {
            setActiveIDs((_activeIds) =>
              _activeIds.length === 0 ? _activeIds : [],
            );
          }
          if (!hasAnchorKey) {
            setActiveAnchorKey(null);
          }
          if (!tags.has('collaboration') && $isRangeSelection(selection)) {
            setShowCommentInput(false);
          }
        });
      }),
      editor.registerCommand(
        INSERT_INLINE_COMMAND,
        () => {
          const domSelection = window.getSelection();
          if (domSelection !== null) {
            domSelection.removeAllRanges();
          }
          setShowCommentInput(true);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor, markNodeMap]);

  const onAddComment = () => {
    editor.dispatchCommand(INSERT_INLINE_COMMAND, undefined);
  };

  return (
    <>
      {showCommentInput &&
        createPortal(
          <CommentInputBox
            editor={editor}
            cancelAddComment={cancelAddComment}
            submitAddComment={submitAddComment}
          />,
          document.body,
        )}
      {activeAnchorKey !== null &&
        activeAnchorKey !== undefined &&
        !showCommentInput &&
        createPortal(
          <AddCommentBox
            anchorKey={activeAnchorKey}
            editor={editor}
            onAddComment={onAddComment}
          />,
          document.body,
        )}
    </>
  );
}
