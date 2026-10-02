/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class DriveFileNovelDownloadDisabled1790908631620 {
    name = 'DriveFileNovelDownloadDisabled1790908631620'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" ADD "novelDownloadDisabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "drive_file"."novelDownloadDisabled" IS 'Whether other users may not download this novel text file; only its text is shown in the novel viewer (JUICE).'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "drive_file" DROP COLUMN "novelDownloadDisabled"`);
    }
}
