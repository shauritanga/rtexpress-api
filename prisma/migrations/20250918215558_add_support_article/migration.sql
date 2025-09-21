-- CreateTable
CREATE TABLE `SupportArticle` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `contentHtml` VARCHAR(191) NULL,
    `contentText` VARCHAR(191) NULL,
    `tags` JSON NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupportArticle_slug_key`(`slug`),
    INDEX `SupportArticle_isPublished_category_idx`(`isPublished`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportArticle` ADD CONSTRAINT `SupportArticle_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
