/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 承認式にしたアカウントのデータのインポートの申請
export class ImportRequest1791190721549 {
    name = 'ImportRequest1791190721549'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "import_request" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "type" character varying(32) NOT NULL, "fileId" character varying(32), "fileName" character varying(256) NOT NULL, "fileSize" integer NOT NULL, "withReplies" boolean, "status" character varying(16) NOT NULL DEFAULT 'pending', "rejectReason" text, "reviewerId" character varying(32), "reviewedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_80148cb44e701ca9bf8f0230f69" PRIMARY KEY ("id")); COMMENT ON COLUMN "import_request"."userId" IS 'The ID of the requester (JUICE).'; COMMENT ON COLUMN "import_request"."type" IS 'The kind of import: following, muting, blocking, userLists or antennas (JUICE).'; COMMENT ON COLUMN "import_request"."fileId" IS 'The ID of the drive file to import (JUICE).'; COMMENT ON COLUMN "import_request"."fileName" IS 'The name of the drive file at the time of the request (JUICE).'; COMMENT ON COLUMN "import_request"."fileSize" IS 'The size of the drive file in bytes at the time of the request (JUICE).'; COMMENT ON COLUMN "import_request"."withReplies" IS 'The withReplies option of a following import (JUICE).'; COMMENT ON COLUMN "import_request"."status" IS 'The review status (JUICE).'; COMMENT ON COLUMN "import_request"."rejectReason" IS 'The reason for the rejection (JUICE).'; COMMENT ON COLUMN "import_request"."reviewerId" IS 'The ID of the reviewer (JUICE).'; COMMENT ON COLUMN "import_request"."reviewedAt" IS 'The date of the review (JUICE).'`);
        await queryRunner.query(`CREATE INDEX "IDX_36c792ff31e4301bdaff1f0d83" ON "import_request" ("fileId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9c210d999ecc45f46381bc4637" ON "import_request" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_012a9d742751abd069bb0d78b9" ON "import_request" ("reviewerId") `);
        await queryRunner.query(`CREATE INDEX "IDX_47dbdd5f427c1bac513b9ecfdc" ON "import_request" ("userId", "type", "status") `);
        await queryRunner.query(`ALTER TABLE "import_request" ADD CONSTRAINT "FK_153f5e82aaef4355c9fa7ab4ee0" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "import_request" ADD CONSTRAINT "FK_36c792ff31e4301bdaff1f0d83d" FOREIGN KEY ("fileId") REFERENCES "drive_file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "import_request" ADD CONSTRAINT "FK_012a9d742751abd069bb0d78b9e" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "import_request" DROP CONSTRAINT "FK_012a9d742751abd069bb0d78b9e"`);
        await queryRunner.query(`ALTER TABLE "import_request" DROP CONSTRAINT "FK_36c792ff31e4301bdaff1f0d83d"`);
        await queryRunner.query(`ALTER TABLE "import_request" DROP CONSTRAINT "FK_153f5e82aaef4355c9fa7ab4ee0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47dbdd5f427c1bac513b9ecfdc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_012a9d742751abd069bb0d78b9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c210d999ecc45f46381bc4637"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36c792ff31e4301bdaff1f0d83"`);
        await queryRunner.query(`DROP TABLE "import_request"`);
    }
}
