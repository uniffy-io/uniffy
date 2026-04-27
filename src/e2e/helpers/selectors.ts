/**
 * Central registry of stable test selectors.
 *
 * Specs reference these constants instead of hard-coding `data-testid`
 * strings. Renaming an anchor in the UI then becomes a one-line change
 * here. Keep this file flat; group by surface, not by test.
 *
 * All values must mirror the `data-testid` attributes added in the
 * Phase 1 testid pass.
 */

export const auth = {
  formLogin: 'auth-form-login',
  formRegister: 'auth-form-register',
  modeLogin: 'auth-mode-login',
  modeRegister: 'auth-mode-register',
  submitLogin: 'auth-submit-login',
  submitRegister: 'auth-submit-register',
  errorBanner: 'auth-error-banner',
  inputLoginEmail: 'auth-input-login-email',
  inputLoginPassword: 'auth-input-login-password',
  inputRegisterEmail: 'auth-input-reg-email',
  inputRegisterUsername: 'auth-input-reg-username',
  inputRegisterPassword: 'auth-input-reg-password',
  inputRegisterFullname: 'auth-input-reg-fullname',
} as const;

export const sidebar = {
  root: 'chat-sidebar-root',
  search: 'chat-sidebar-search',
  collapseToggle: 'chat-sidebar-collapse-toggle',
  createChannelButton: 'chat-sidebar-create-channel-button',
  createCategoryButton: 'chat-sidebar-create-category-button',
  browseChannelsButton: 'chat-sidebar-browse-channels-button',
  newDmButton: 'chat-sidebar-new-dm-button',
  threadsLink: 'chat-sidebar-threads-link',
  threadsUnreadBadge: 'chat-sidebar-threads-unread-badge',
  unreadsLink: 'chat-sidebar-unreads-link',
  unreadsBadge: 'chat-sidebar-unreads-badge',
  dmSection: 'chat-sidebar-dm-section',
  dmToggle: 'chat-sidebar-dm-toggle',
  channel: (id: string) => `chat-sidebar-channel-${id}`,
  channelName: (id: string) => `chat-sidebar-channel-name-${id}`,
  channelMentionBadge: (id: string) => `chat-sidebar-channel-mention-badge-${id}`,
  channelUnreadBadge: (id: string) => `chat-sidebar-channel-unread-badge-${id}`,
  dm: (id: string) => `chat-sidebar-dm-${id}`,
  dmName: (id: string) => `chat-sidebar-dm-name-${id}`,
  dmUnreadBadge: (id: string) => `chat-sidebar-dm-unread-badge-${id}`,
  category: (id: string | null) => `chat-sidebar-category-${id ?? 'uncategorized'}`,
  categoryToggle: (id: string | null) => `chat-sidebar-category-toggle-${id ?? 'uncategorized'}`,
  categoryAddChannel: (id: string | null) => `chat-sidebar-category-add-channel-${id ?? 'uncategorized'}`,
  categoryEdit: (id: string) => `chat-sidebar-category-edit-${id}`,
  categoryDelete: (id: string) => `chat-sidebar-category-delete-${id}`,
} as const;

export const channel = {
  view: 'chat-channel-view',
  header: 'chat-channel-header',
  name: 'chat-channel-name',
  membersButton: 'chat-channel-members-button',
  searchButton: 'chat-channel-search-button',
  pinnedButton: 'chat-channel-pinned-button',
  pinnedCount: 'chat-channel-pinned-count',
  resourcesButton: 'chat-channel-resources-button',
  splitButton: 'chat-channel-split-button',
  settingsButton: 'chat-channel-settings-button',
  closeSplit: 'chat-channel-close-split-button',
  agentContextToggle: 'chat-channel-agent-context-toggle',
  agentsToggle: 'chat-channel-agents-toggle',
  agentsPopover: 'chat-channel-agents-popover',
  agentsPopoverClose: 'chat-channel-agents-popover-close',
  agentsPopoverRow: (agentId: string) => `chat-channel-agents-popover-row-${agentId}`,
  agentsPopoverToggle: (agentId: string) => `chat-channel-agents-popover-toggle-${agentId}`,
} as const;

export const messages = {
  list: 'chat-message-list',
  dateSeparator: 'chat-date-separator',
  unreadSeparator: 'chat-unread-separator',
  row: (id: string) => `chat-message-row-${id}`,
  message: (id: string) => `chat-message-${id}`,
  body: (id: string) => `chat-message-body-${id}`,
  author: (id: string) => `chat-message-author-${id}`,
  timestamp: (id: string) => `chat-message-timestamp-${id}`,
  agentBadge: (id: string) => `chat-message-agent-badge-${id}`,
  pinnedIcon: (id: string) => `chat-message-pinned-icon-${id}`,
  editedMarker: (id: string) => `chat-message-edited-marker-${id}`,
  actions: (id: string) => `chat-message-actions-${id}`,
  reactButton: (id: string) => `chat-message-react-button-${id}`,
  threadButton: (id: string) => `chat-message-thread-button-${id}`,
  pinButton: (id: string) => `chat-message-pin-button-${id}`,
  replyButton: (id: string) => `chat-message-reply-button-${id}`,
  moreButton: (id: string) => `chat-message-more-button-${id}`,
  moreMenu: (id: string) => `chat-message-more-menu-${id}`,
  copyText: (id: string) => `chat-message-copy-text-${id}`,
  copyLink: (id: string) => `chat-message-copy-link-${id}`,
  editButton: (id: string) => `chat-message-edit-button-${id}`,
  deleteButton: (id: string) => `chat-message-delete-button-${id}`,
} as const;

export const compose = {
  root: 'chat-compose-root',
  input: 'chat-compose-input',
  sendButton: 'chat-compose-send-button',
  attachButton: 'chat-compose-attach-button',
  emojiButton: 'chat-compose-emoji-button',
  mentionButton: 'chat-compose-mention-button',
  codeButton: 'chat-compose-code-button',
  boldButton: 'chat-compose-bold-button',
  editBanner: 'chat-compose-edit-banner',
  editCancel: 'chat-compose-edit-cancel',
  replyBanner: 'chat-compose-reply-banner',
  replyCancel: 'chat-compose-reply-cancel',
  attachments: 'chat-compose-attachments',
  attachment: (id: string) => `chat-compose-attachment-${id}`,
  attachmentRemove: (id: string) => `chat-compose-attachment-remove-${id}`,
} as const;

export const streaming = {
  content: 'chat-streaming-content',
  toolCall: (id: string) => `chat-agent-tool-call-${id}`,
  toolCallToggle: (id: string) => `chat-agent-tool-call-toggle-${id}`,
  toolCallArgs: (id: string) => `chat-agent-tool-call-args-${id}`,
  toolResult: (id: string) => `chat-agent-tool-result-${id}`,
  toolResultToggle: (id: string) => `chat-agent-tool-result-toggle-${id}`,
  toolResultBody: (id: string) => `chat-agent-tool-result-body-${id}`,
  confirmation: (id: string) => `chat-agent-confirmation-${id}`,
  confirmationAllow: (id: string) => `chat-agent-confirmation-allow-${id}`,
  confirmationDeny: (id: string) => `chat-agent-confirmation-deny-${id}`,
} as const;

export const agentContextBar = {
  root: 'chat-agent-context-bar',
  progress: 'chat-agent-context-progress',
  percent: 'chat-agent-context-percent',
  compactButton: 'chat-agent-context-compact-button',
  resetButton: 'chat-agent-context-reset-button',
  menuButton: 'chat-agent-context-menu-button',
  menu: 'chat-agent-context-menu',
  menuReset: 'chat-agent-context-menu-reset',
} as const;

export const search = {
  popover: 'chat-search-popover',
  input: 'chat-search-input',
  clear: 'chat-search-clear',
  filters: 'chat-search-filters',
  filterChannelScope: 'chat-search-filter-channel-scope',
  filterSender: 'chat-search-filter-sender',
  filterSenderActive: 'chat-search-filter-sender-active',
  filterSenderClear: 'chat-search-filter-sender-clear',
  filterClearAll: 'chat-search-filter-clear-all',
  result: (urn: string) => `chat-search-result-${urn}`,
  resultButton: (messageId: string) => `chat-search-result-button-${messageId}`,
} as const;

export const thread = {
  panel: 'chat-thread-panel',
  scroll: 'chat-thread-scroll',
  messages: 'chat-thread-messages',
  copyLink: 'chat-thread-copy-link',
  close: 'chat-thread-close',
  inboxRoot: 'chat-threads-inbox',
  inboxTabAll: 'chat-threads-inbox-tab-all',
  inboxTabUnreads: 'chat-threads-inbox-tab-unreads',
  inboxItem: (rootMessageId: string) => `chat-thread-inbox-item-${rootMessageId}`,
} as const;

export const reactions = {
  bar: 'chat-reaction-bar',
  add: 'chat-reaction-add',
  one: (emoji: string) => `chat-reaction-${emoji}`,
} as const;

export const modals = {
  createChannelModal: 'chat-create-channel-modal',
  createChannelClose: 'chat-create-channel-close',
  createChannelName: 'chat-create-channel-name-input',
  createChannelDescription: 'chat-create-channel-description-input',
  createChannelTypePublic: 'chat-create-channel-type-public',
  createChannelTypePrivate: 'chat-create-channel-type-private',
  createChannelCancel: 'chat-create-channel-cancel',
  createChannelSubmit: 'chat-create-channel-submit',

  createCategoryModal: 'chat-create-category-modal',
  createCategoryClose: 'chat-create-category-close',
  createCategoryName: 'chat-create-category-name-input',
  createCategoryCancel: 'chat-create-category-cancel',
  createCategorySubmit: 'chat-create-category-submit',

  browseChannelsModal: 'chat-browse-channels-modal',
  browseChannelsClose: 'chat-browse-channels-close',
  browseChannelsSearch: 'chat-browse-channels-search',
  browseChannelsRow: (id: string) => `chat-browse-channels-row-${id}`,
  browseChannelsJoin: (id: string) => `chat-browse-channels-join-${id}`,
  browseChannelsOpen: (id: string) => `chat-browse-channels-open-${id}`,

  newDmModal: 'chat-new-dm-modal',
  newDmClose: 'chat-new-dm-close',
  newDmSearchInput: 'chat-new-dm-search-input',
  newDmCancel: 'chat-new-dm-cancel',
  newDmSubmit: 'chat-new-dm-submit',
  newDmUser: (id: string) => `chat-new-dm-user-${id}`,
  newDmAgent: (id: string) => `chat-new-dm-agent-${id}`,

  channelSettingsModal: 'chat-channel-settings-modal',
  channelSettingsClose: 'chat-channel-settings-close',
  channelSettingsTab: (key: 'overview' | 'members') => `chat-channel-settings-tab-${key}`,
  channelSettingsSave: 'chat-channel-settings-save',
  channelSettingsDiscard: 'chat-channel-settings-discard',

  confirmDialog: 'confirm-dialog',
  confirmDialogTitle: 'confirm-dialog-title',
  confirmDialogMessage: 'confirm-dialog-message',
  confirmDialogConfirm: 'confirm-dialog-confirm',
  confirmDialogCancel: 'confirm-dialog-cancel',
  confirmDialogClose: 'confirm-dialog-close',
} as const;

export const mentionPopup = {
  root: 'chat-mention-popup',
  input: 'chat-mention-popup-input',
} as const;

export const agents = {
  page: 'agents-page',
  view: 'agents-view',
  listPanel: 'agents-list-panel',
  refreshButton: 'agents-refresh-button',
  createButton: 'agents-create-button',
  createForm: 'agents-create-form',
  createNameInput: 'agents-create-name-input',
  createSubmit: 'agents-create-submit',
  detailPanel: 'agents-detail-panel',
  detailName: 'agents-detail-name',
  cloneButton: 'agents-clone-button',
  moveToOrgButton: 'agents-move-to-org-button',
  shareButton: 'agents-share-button',
  detailTab: (key: string) => `agents-detail-tab-${key}`,
  listRow: (id: string) => `agents-list-row-${id}`,
  avatar: 'agent-avatar',
} as const;
