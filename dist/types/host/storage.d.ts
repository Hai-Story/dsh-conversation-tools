/** Non-model annotations and version relationships, stored outside immutable transcripts. */
import { z } from 'zod';
import { SessionId } from '@deepseek-ai/dsh-session/types';
declare const editRecord: z.ZodObject<{
    sourceSessionId: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
    childSessionId: z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>;
    fingerprint: z.ZodString;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
/** Persisted identity of one editing submission. */
export type EditRecord = z.infer<typeof editRecord>;
/** Sidecar metadata is invisible to the model and does not rewrite Session events. */
export declare const conversationToolsDomain: {
    name: string;
    version: number;
    tables: {
        stars: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, {
            turns: number[];
        }>;
        edits: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            sourceSessionId: SessionId;
            childSessionId: SessionId;
            fingerprint: string;
            createdAt: number;
        }>;
    };
};
export {};
