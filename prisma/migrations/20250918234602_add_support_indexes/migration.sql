-- CreateIndex
CREATE FULLTEXT INDEX `SupportCannedResponse_title_contentText_idx` ON `SupportCannedResponse`(`title`, `contentText`);

-- CreateIndex
CREATE INDEX `SupportTicket_createdAt_idx` ON `SupportTicket`(`createdAt`);

-- CreateIndex
CREATE INDEX `SupportTicket_status_assignedToUserId_idx` ON `SupportTicket`(`status`, `assignedToUserId`);

-- RenameIndex
ALTER TABLE `SupportAttachment` RENAME INDEX `SupportAttachment_messageId_fkey` TO `SupportAttachment_messageId_idx`;

-- RenameIndex
ALTER TABLE `SupportMessage` RENAME INDEX `SupportMessage_authorUserId_fkey` TO `SupportMessage_authorUserId_idx`;

-- RenameIndex
ALTER TABLE `SupportTicket` RENAME INDEX `SupportTicket_customerId_fkey` TO `SupportTicket_customerId_idx`;

-- RenameIndex
ALTER TABLE `SupportTicket` RENAME INDEX `SupportTicket_requesterUserId_fkey` TO `SupportTicket_requesterUserId_idx`;
