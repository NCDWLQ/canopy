# Product Requirements Document

## Overview
Develop a Conversation Workspace frontend for Canopy, providing a desktop-first, tree-native conversation interface. The workspace will allow users to view, navigate, and manage multi-branched conversations with an AI assistant.

## Features
1. **Layout**:
   - Left side: Conversation tree/outline.
   - Middle: Active path from root to the currently selected node (siblings hidden).
2. **Conversation Capabilities**:
   - Create new conversation.
   - Select node (changes active path).
   - Expand/collapse tree outline.
   - Create branch.
   - Edit node as branch (mutates to a new branch, keeping history intact).
   - Append to node.
   - Archive conversation (disables mutations, retains read access).
3. **Behavioral Constraints**:
   - Only the active root-to-node path is shown; sibling branches are strictly isolated.
   - Editing is a branch creation operation; no historical node is mutated.
   - Archiving operates on the entire conversation, not individual nodes or subtrees.
   - Conversations with only a user root must not display a forged assistant node.
   - If a conversation is archived, `conversation.isArchived` disables all write operations universally.
   - Malformed trees or paths must fail closed (show error), never falling back to showing the entire conversation.
   - Placeholder UI for missing capabilities (e.g., generation/provider buttons) should clearly indicate unavailability.

## Non-Functional Requirements
- **Persistence**: SQLite is the sole durable source of truth. No local storage for conversations or persistence in Zustand.
- **Design**: Use the existing shadcn/Radix/Tailwind ecosystem. Maintain a clean, desktop-focused tree interface without unnecessary generic dashboard elements or heavy gradients.
- **Accessibility**: Full keyboard support, clear focus rings, semantic tree elements, accessible icon buttons, reduced-motion compatibility.
