/*
  Warnings:

  - You are about to drop the column `fullName` on the `BookingRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `BookingRequest` DROP COLUMN `fullName`,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `companyName` VARCHAR(191) NULL,
    ADD COLUMN `contactPerson` VARCHAR(191) NULL,
    ADD COLUMN `convertedCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `country` VARCHAR(191) NULL,
    ADD COLUMN `customerType` ENUM('INDIVIDUAL', 'BUSINESS') NOT NULL DEFAULT 'INDIVIDUAL',
    ADD COLUMN `firstName` VARCHAR(191) NULL,
    ADD COLUMN `lastName` VARCHAR(191) NULL,
    ADD COLUMN `state` VARCHAR(191) NULL,
    ADD COLUMN `street` VARCHAR(191) NULL,
    ADD COLUMN `taxId` VARCHAR(191) NULL,
    ADD COLUMN `zipCode` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SupportTicket` ADD COLUMN `lastSlaBreachNotifiedAt` DATETIME(3) NULL,
    ADD COLUMN `lastSlaWarnNotifiedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `BookingRequest_customerType_idx` ON `BookingRequest`(`customerType`);

-- CreateIndex
CREATE INDEX `BookingRequest_email_idx` ON `BookingRequest`(`email`);
