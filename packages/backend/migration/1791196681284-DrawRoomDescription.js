/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャの部屋に説明(どんな絵を描く部屋か。一覧にも出す)を書けるようにする
export class DrawRoomDescription1791196681284 {
    name = 'DrawRoomDescription1791196681284';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room" ADD "description" character varying(512)`);
        await queryRunner.query(`COMMENT ON COLUMN "draw_room"."description" IS 'The description of the room shown in the room list (JUICE).'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room" DROP COLUMN "description"`);
    }
};
