/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャの部屋に注意書き(CW)と、センシティブ(NSFW)の印を付けられるようにする
export class DrawRoomCwSensitive1790548154915 {
    name = 'DrawRoomCwSensitive1790548154915';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room" ADD "cw" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "draw_room" ADD "isSensitive" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "draw_room"."cw" IS 'Content warning shown before opening the room (JUICE).'`);
        await queryRunner.query(`COMMENT ON COLUMN "draw_room"."isSensitive" IS 'Whether the room contains sensitive (NSFW) drawings (JUICE).'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room" DROP COLUMN "isSensitive"`);
        await queryRunner.query(`ALTER TABLE "draw_room" DROP COLUMN "cw"`);
    }
};
