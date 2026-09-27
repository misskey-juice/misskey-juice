/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャで1人が複数のレイヤーを持てるように、保存した部屋のレイヤーの一覧(名前・表示・濃さ・重なり順)を残す
export class DrawRoomUserLayers1790426554707 {
    name = 'DrawRoomUserLayers1790426554707';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room_layer" ADD "layers" jsonb`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "draw_room_layer" DROP COLUMN "layers"`);
    }
};
