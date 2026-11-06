/** Copy owned by the optional conversation tools. */
export const NS = 'conversationTools'
/** English dictionary. */
export const en = {
  star: 'Star this exchange', unstar: 'Remove star', starred: 'Starred exchange', edit: 'Edit message',
  save: 'Save and regenerate', cancel: 'Cancel', saving: 'Saving…',
  retained: 'Editing leaves the current task running. Submit to stop it and regenerate. Previous replies are kept; file and command effects are not undone.',
  failed: 'Could not save. Your draft is preserved; retry with the same text.',
  loadFailed: 'Could not load conversation annotations', retry: 'Retry',
  versions: 'Conversation versions', version: 'Version {number}',
  starFailed: 'Could not update star', recovery: 'Open saved version',
  partial: 'A version was saved but could not be linked. Open it to continue; the original is preserved.',
}
/** Dictionary keys. */
export type ToolsKey = keyof typeof en
/** Simplified Chinese dictionary. */
export const zh: Record<ToolsKey, string> = {
  star: '星标这轮问答', unstar: '取消星标', starred: '已星标的问答', edit: '编辑消息',
  save: '保存并重新生成', cancel: '取消', saving: '正在保存…',
  retained: '编辑时原任务继续运行，提交后才会中断并重新生成。旧对话保留，已执行的文件修改和命令不会撤销',
  failed: '保存失败，草稿已保留，请保持内容不变后重试',
  loadFailed: '无法加载对话标记', retry: '重试',
  versions: '对话历史版本', version: '版本 {number}',
  starFailed: '星标更新失败', recovery: '打开已保存的版本',
  partial: '新版本已保存，但历史关联未能写入。可打开新版本继续，原对话仍保留',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { conversationTools: ToolsKey }
}
