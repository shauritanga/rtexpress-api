/*
  Warnings:

  - A unique constraint covering the columns `[ownerId]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `Customer_ownerId_key` ON `Customer`(`ownerId`);
