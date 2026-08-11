/**
 * Front context subscription.
 *
 * Verified against @frontapp/plugin-sdk 1.10.0 / @frontapp/ui-bridge 2.0.0-beta19:
 *   - Front.contextUpdates is an rxjs Observable of WebViewContext
 *   - context.type is 'noConversation' | 'singleConversation' | 'multiConversations'
 *     (plus message/composer/popover variants we do not render)
 *   - singleConversation carries conversation.customFieldAttributes,
 *     .inboxes, .recipient, and the listMessages()/createDraft() functions
 *
 * The dev-mode timer is the same trick used in ScalapayPlugin: if Front has not
 * completed its handshake within 1.5s we are running in a plain browser tab, so
 * the panel switches to a manual mode that can still be built and demoed.
 */

import { useEffect, useState } from 'react';
import Front from '@frontapp/plugin-sdk';
import type { InboxRef } from '../fieldSets';

export type ContextKind = 'loading' | 'dev' | 'none' | 'single' | 'multi';

/**
 * Stand-in conversation id used outside Front, so the snapshot round-trip can be
 * rehearsed in a plain browser tab:
 *   curl -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
 *     -d '{"Machine(s)":"X-RAY"}' $BACKEND/api/tickets/cnv_demo/snapshot
 */
export const DEV_CONVERSATION_ID = 'cnv_demo';

export interface CustomFieldValue {
  name: string;
  type: string;
  value: unknown;
}

export interface FrontState {
  kind: ContextKind;
  conversationId: string | null;
  subject: string | null;
  inboxes: InboxRef[];
  customFields: CustomFieldValue[];
  /** Ticket status id. Only set when ticketing is enabled on the inbox. */
  statusId: string | null;
  /** 'open' | 'waiting' | 'resolved' when ticketing is enabled. */
  statusCategory: string | null;
  /** Conversation status: open | archived | trashed | spam. Always present. */
  status: string | null;
  /** Raw SDK context, retained for listMessages() and createDraft(). */
  context: any | null;
}

const INITIAL: FrontState = {
  kind: 'loading',
  conversationId: null,
  subject: null,
  inboxes: [],
  customFields: [],
  statusId: null,
  statusCategory: null,
  status: null,
  context: null,
};

export function useFrontContext(): FrontState {
  const [state, setState] = useState<FrontState>(INITIAL);

  useEffect(() => {
    let handshakeSeen = false;

    const devModeTimer = setTimeout(() => {
      if (!handshakeSeen) {
        setState({
          ...INITIAL,
          kind: 'dev',
          conversationId: DEV_CONVERSATION_ID,
          // Stand-in so the status row renders outside Front. Inside Front this
          // comes from the conversation and is never faked.
          statusCategory: 'open',
          status: 'open',
        });
      }
    }, 1500);

    const subscription = Front.contextUpdates.subscribe((context: any) => {
      handshakeSeen = true;
      clearTimeout(devModeTimer);

      if (context.type === 'singleConversation') {
        const conversation = context.conversation ?? {};
        setState({
          kind: 'single',
          conversationId: conversation.id ?? null,
          subject: conversation.subject ?? null,
          inboxes: (conversation.inboxes ?? []).map((inbox: any) => ({
            id: String(inbox.id ?? ''),
            name: String(inbox.name ?? ''),
          })),
          customFields: (conversation.customFieldAttributes ?? []).map((field: any) => ({
            name: String(field.name ?? ''),
            type: String(field.type ?? 'unknown'),
            value: field.value,
          })),
          statusId: conversation.statusId ? String(conversation.statusId) : null,
          statusCategory: conversation.statusCategory ? String(conversation.statusCategory) : null,
          status: conversation.status ? String(conversation.status) : null,
          context,
        });
        return;
      }

      if (context.type === 'multiConversations') {
        setState({ ...INITIAL, kind: 'multi', context });
        return;
      }

      // noConversation, and the message/composer/popover variants we do not render.
      setState({ ...INITIAL, kind: 'none', context });
    });

    return () => {
      clearTimeout(devModeTimer);
      subscription?.unsubscribe?.();
    };
  }, []);

  return state;
}
