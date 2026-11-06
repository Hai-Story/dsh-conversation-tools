import { Context, Service } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { ConversationToolsSnapshot, EditMessageRequest, EditMessageResult, StarTurnRequest } from '../types.ts';
export type * from '../types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        conversationTools: ConversationTools;
    }
}
/** Durable annotations and idempotent editing submissions. */
export default class ConversationTools extends TypertRemoteService {
    static inject: string[];
    private domain;
    private readonly pending;
    private readonly unlinked;
    private closing;
    private annotationTail;
    /** @param ctx - Host plugin context. */
    constructor(ctx: Context);
    protected [Service.init](): Promise<void>;
    /**
     * Read bookmarks and version identities without loading model history.
     * @param sessionId - viewed Session.
     * @returns its bookmarks and accessible retained versions.
     */
    snapshot(sessionId: SessionId): ConversationToolsSnapshot;
    /**
     * Save an explicit bookmark state without changing conversation context.
     * @param request - desired bookmark state.
     * @returns annotations after durable storage.
     */
    star(request: StarTurnRequest): Promise<ConversationToolsSnapshot>;
    private writeStar;
    /**
     * Preserve the original Session and submit one replacement message to an exact-prefix version.
     * @param request - durable target and retry identity.
     * @returns the new Session, or an explicit recoverable child identity on partial failure.
     */
    edit(request: EditMessageRequest): Promise<EditMessageResult>;
    private createVersion;
    /** Missing listeners are an unsupported persistence capability, not a failed disk write. */
    private checkpoint;
    /** Catch only synchronous acquisition failure; errors inside the task keep their own classification. */
    private maintain;
    private performEdit;
}
