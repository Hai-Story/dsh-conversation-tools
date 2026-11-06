/** Copy owned by the optional conversation tools. */
export const NS = 'conversationTools'
/** English dictionary. */
export const en = {
  star: 'Star this exchange', unstar: 'Remove star', starred: 'Starred exchange', edit: 'Edit message',
  editing: 'Editing a sent message', cancelEdit: 'Cancel edit', saving: 'Stopping and regenerating…',
  submitHint: 'Send to regenerate · previous version kept',
  failed: 'Could not save. Your draft is preserved; retry with the same text.',
  loadFailed: 'Could not load conversation annotations', retry: 'Retry',
  versions: 'Conversation versions', version: 'Version {number}',
  starFailed: 'Could not update star', recovery: 'Open saved version',
  partial: 'A version exists, but this edit is unfinished. Your draft is kept; send it again unchanged to recover.',
  busy: 'This conversation is handling another operation. Your draft is kept; try again shortly.',
  persistenceUnavailable: 'Durable conversation storage is unavailable. Check the DSH profile before retrying.',
  recoveryUnavailable: 'The saved version could not be linked after the host restarted. Your edit text is kept; open the version to continue manually.',
  resumeEdit: 'Restore edit draft', beginFailed: 'Could not open the editor. Refresh this conversation and try again.',
  openFailed: 'Could not open this version. Try again.', dismiss: 'Dismiss',
  sessionUnavailable: 'Conversation tools will be available when this conversation reconnects.',
  uiUnsupported: 'Some message tools cannot attach to this UI. Check the supported DSH version; details are in the console.',
}
/** Dictionary keys. */
export type ToolsKey = keyof typeof en
/** Simplified Chinese dictionary. */
export const zh: Record<ToolsKey, string> = {
  star: '星标这轮问答', unstar: '取消星标', starred: '已星标的问答', edit: '编辑消息',
  editing: '正在编辑已发送消息', cancelEdit: '取消编辑', saving: '正在停止并重新生成…',
  submitHint: '发送后重新生成 · 保留旧版本',
  failed: '保存失败，草稿已保留，请保持内容不变后重试',
  loadFailed: '无法加载对话标记', retry: '重试',
  versions: '对话历史版本', version: '版本 {number}',
  starFailed: '星标更新失败', recovery: '打开已保存的版本',
  partial: '新会话已创建，但编辑尚未完成。草稿已保留，保持内容不变再次发送可恢复',
  busy: '该对话正在处理其他操作，草稿已保留，请稍后重试',
  persistenceUnavailable: '当前缺少会话持久化能力，请检查 DSH 配置后重试',
  recoveryUnavailable: '宿主重启后无法自动补回版本关联。修改文本已保留，可打开已创建的会话手动继续',
  resumeEdit: '恢复编辑草稿', beginFailed: '无法打开编辑器，请刷新当前对话后重试',
  openFailed: '无法打开该版本，请重试', dismiss: '关闭提示',
  sessionUnavailable: '会话重新连接后，对话工具将自动恢复',
  uiUnsupported: '部分消息工具无法接入当前界面，请检查支持的 DSH 版本；诊断详情已记录到控制台',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { conversationTools: ToolsKey }
}
