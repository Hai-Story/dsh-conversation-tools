var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/host/index.ts
import { createHash } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { Remote, RemoteError, TypertRemoteService, principalOf } from "@deepseek-ai/dsh-typert-protocol";

// src/host/storage.ts
import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
var sessionId = z.string().min(1).transform(SessionId);
var editRecord = z.object({
  sourceSessionId: sessionId,
  childSessionId: sessionId,
  fingerprint: z.string(),
  createdAt: z.number().int().nonnegative()
});
var conversationToolsDomain = defineDomain({
  name: "conversation_tools",
  version: 1,
  tables: {
    stars: domainTable(z.object({ turns: z.array(z.number().int().nonnegative()) })),
    edits: domainTable(editRecord)
  }
});

// src/host/edit-plan.ts
function planMessageEdit(events, messageId, text) {
  let turn = 0, turnStart = 0, humanInTurn = false;
  for (const event of events) {
    if (event.type === "turn/start") {
      turn = event.data.turn;
      turnStart = event.seq;
      humanInTurn = false;
    }
    if (event.type !== "user/message" || event.surfaceOp !== "append" || event.data.source.kind !== "user") continue;
    if (event.data.id !== messageId) {
      humanInTurn = true;
      continue;
    }
    let inserted = false;
    const content = [];
    for (const block of event.data.content) {
      if (block.type !== "text") content.push(block);
      else if (!inserted) {
        inserted = true;
        content.push({ type: "text", text });
      }
    }
    if (!inserted) content.unshift({ type: "text", text });
    return { beforeSeq: humanInTurn ? event.seq : turnStart, turn, content };
  }
  return void 0;
}

// src/host/index.ts
var _edit_dec, _star_dec, _snapshot_dec, _a, _init, _b;
var ConversationTools = class extends (_b = TypertRemoteService) {
  /** @param ctx - Host plugin context. */
  constructor(ctx) {
    super(ctx, "conversationTools");
    __runInitializers(_init, 5, this);
    __publicField(this, "domain");
    __publicField(this, "pending", /* @__PURE__ */ new Map());
    __publicField(this, "closing", false);
    __publicField(this, "annotationTail", Promise.resolve());
  }
  async [(_a = Service.init, _snapshot_dec = [Remote], _star_dec = [Remote], _edit_dec = [Remote], _a)]() {
    this.domain = await this.ctx.storageDomain.open(conversationToolsDomain);
    this.ctx.effect(() => async () => {
      this.closing = true;
      await Promise.allSettled([this.annotationTail, ...[...this.pending.values()].map((value) => value.operation)]);
      await this.domain.close();
    });
  }
  snapshot(sessionId2) {
    const edits = [...this.domain.table("edits").entries()].map(([, entry]) => entry);
    const family = /* @__PURE__ */ new Set([sessionId2]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edit of edits) {
        if (!family.has(edit.sourceSessionId) && !family.has(edit.childSessionId)) continue;
        for (const id of [edit.sourceSessionId, edit.childSessionId]) {
          if (!family.has(id)) {
            family.add(id);
            changed = true;
          }
        }
      }
    }
    return {
      starredTurns: this.domain.table("stars").get(sessionId2)?.turns ?? [],
      versions: [...family].filter((id) => this.ctx.remoteAccess.allows({ kind: "session", id })).map((id) => ({ sessionId: id, createdAt: edits.find((edit) => edit.childSessionId === id)?.createdAt ?? 0 })).sort((a, b) => a.createdAt - b.createdAt)
    };
  }
  star(request) {
    const operation = this.annotationTail.then(() => this.writeStar(request));
    this.annotationTail = operation.then(() => void 0, () => void 0);
    return operation;
  }
  async writeStar(request) {
    var _stack = [];
    try {
      if (this.closing) throw new Error("Conversation tools are unloading");
      const observation = __using(_stack, await this.ctx.sessionQuery.observeSession(request.sessionId));
      if (!observation.events.some((event) => event.type === "turn/start" && event.data.turn === request.turn)) {
        throw new RemoteError("conversationTools/rejected", "Turn does not exist", { reason: "missing-message" });
      }
      const table = this.domain.table("stars");
      if (table.get(request.sessionId) === void 0) await table.put(request.sessionId, { turns: [] });
      await table.update(request.sessionId, (record) => ({ turns: [...new Set(request.starred ? [...record.turns, request.turn] : record.turns.filter((turn) => turn !== request.turn))].sort((a, b) => a - b) }));
      return this.snapshot(request.sessionId);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  edit(request) {
    if (this.closing) return Promise.reject(new Error("Conversation tools are unloading"));
    if (request.text.trim() === "") return Promise.reject(new RemoteError("conversationTools/rejected", "Message is empty", { reason: "empty" }));
    const fingerprint = createHash("sha256").update(JSON.stringify([request.sessionId, request.messageId, request.text])).digest("hex");
    const current = this.domain.table("edits").get(request.requestId);
    if (current !== void 0 && current.fingerprint !== fingerprint) {
      return Promise.reject(new RemoteError("conversationTools/rejected", "Retry content changed", { reason: "request-conflict" }));
    }
    const pending = this.pending.get(request.requestId);
    if (pending !== void 0) return pending.fingerprint === fingerprint ? pending.operation : Promise.reject(new RemoteError("conversationTools/rejected", "Retry content changed", { reason: "request-conflict" }));
    const operation = this.performEdit(request, fingerprint).finally(() => {
      this.pending.delete(request.requestId);
    });
    this.pending.set(request.requestId, { fingerprint, operation });
    return operation;
  }
  createVersion(source, beforeSeq) {
    if (beforeSeq > 0) return this.ctx.sessionController.fork({ sessionId: source.id, atSeq: beforeSeq - 1 });
    const workspace = this.ctx.workspaceRegistry.list().find((entry) => entry.sessionIds.includes(source.id));
    return this.ctx.sessionController.create({
      ...workspace === void 0 ? { cwd: source.session.header.cwd ?? this.ctx.workingDirectory.get(source.session) } : { workspaceId: workspace.id },
      ...source.session.header.agentPreset === void 0 ? {} : { agentPreset: source.session.header.agentPreset }
    });
  }
  async performEdit(request, fingerprint) {
    const resolved = await this.ctx.sessionController.resolveAgent(request.sessionId);
    if ("error" in resolved) throw resolved.error;
    const source = resolved.agent;
    const applyEdit = async () => {
      var _stack3 = [];
      try {
        const observation = __using(_stack3, await this.ctx.sessionQuery.observeSession(request.sessionId));
        const plan = planMessageEdit(observation.events, request.messageId, request.text);
        if (plan === void 0) throw new RemoteError("conversationTools/rejected", "Human message does not exist", { reason: "missing-message" });
        let record = this.domain.table("edits").get(request.requestId);
        if (record === void 0) {
          const child = await this.createVersion(source, plan.beforeSeq);
          record = { sourceSessionId: request.sessionId, childSessionId: child.sessionId, fingerprint, createdAt: Date.now() };
          try {
            await this.domain.table("edits").put(request.requestId, record);
          } catch (_error4) {
            throw new RemoteError("conversationTools/incomplete", "Version created but its link could not be saved", { sessionId: child.sessionId, phase: "link" });
          }
          const turns = this.domain.table("stars").get(request.sessionId)?.turns.filter((turn) => turn < plan.turn) ?? [];
          await this.domain.table("stars").put(child.sessionId, { turns });
        }
        const childId = record.childSessionId;
        try {
          var _stack2 = [];
          try {
            const target = await this.ctx.sessionController.resolveAgent(childId);
            if ("error" in target) throw target.error;
            const child = target.agent;
            const previous = __using(_stack2, await this.ctx.sessionQuery.observeSession(childId));
            const submitted = previous.events.some((event) => event.type === "user/message" ? event.data.source.kind === "user" && "rpcId" in event.data.source && event.data.source.rpcId === request.requestId : event.type === "agent/inbox/spliced" && event.data.inserted.some((message) => message.source.kind === "user" && "rpcId" in message.source && message.source.rpcId === request.requestId));
            if (!submitted) {
              await child.runMaintenance(async () => {
                child.inbox.clear();
                const selection = source.model.current();
                if (selection !== void 0) child.model.select(selection);
                await this.ctx.workingDirectory.set(child, this.ctx.workingDirectory.get(source.session));
                const principal = principalOf(this.ctx.invocation);
                child.followup(createUserMessage({ content: plan.content, source: {
                  kind: "user",
                  rpcId: request.requestId,
                  ...principal === void 0 ? {} : { principal }
                } }));
                if (!await this.ctx.sessions.flush(child.session)) throw new Error("Edited message was not persisted");
              });
            }
            if (!await this.ctx.sessions.flush(child.session)) throw new Error("Edited message was not persisted");
            return { sessionId: childId };
          } catch (_2) {
            var _error2 = _2, _hasError2 = true;
          } finally {
            __callDispose(_stack2, _error2, _hasError2);
          }
        } catch (_error4) {
          throw new RemoteError("conversationTools/incomplete", "Version preserved; retry to continue", { sessionId: childId, phase: "submission" });
        }
      } catch (_3) {
        var _error3 = _3, _hasError3 = true;
      } finally {
        __callDispose(_stack3, _error3, _hasError3);
      }
    };
    if (this.domain.table("edits").get(request.requestId) !== void 0) return applyEdit();
    if (source.status !== "idle") {
      var _stack = [];
      try {
        const observation = __using(_stack, await this.ctx.sessionQuery.observeSession(request.sessionId));
        if (planMessageEdit(observation.events, request.messageId, request.text) === void 0) {
          throw new RemoteError("conversationTools/rejected", "Human message does not exist", { reason: "missing-message" });
        }
        this.ctx.sessionController.cancel({ sessionId: request.sessionId });
        await source.whenIdle();
        if (!await this.ctx.sessions.flush(source.session)) throw new Error("Stopped conversation was not persisted");
      } catch (_) {
        var _error = _, _hasError = true;
      } finally {
        __callDispose(_stack, _error, _hasError);
      }
    }
    return source.runMaintenance(applyEdit);
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "snapshot", _snapshot_dec, ConversationTools);
__decorateElement(_init, 1, "star", _star_dec, ConversationTools);
__decorateElement(_init, 1, "edit", _edit_dec, ConversationTools);
__decoratorMetadata(_init, ConversationTools);
__publicField(ConversationTools, "inject", ["storageDomain", "sessionController", "sessionQuery", "sessions", "agents", "workingDirectory", "remoteAccess", "workspaceRegistry"]);
export {
  ConversationTools as default
};
