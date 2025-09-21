-- AlterTable
ALTER TABLE `BookingRequest` ADD COLUMN `consent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `consentAt` DATETIME(3) NULL;
