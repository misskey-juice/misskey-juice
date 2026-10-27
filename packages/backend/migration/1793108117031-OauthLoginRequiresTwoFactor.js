/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 連携ログインは2段階認証が有効なアカウントだけが使える。前は2段階認証を解除しても
// useOauthLogin が残っていたので、2段階認証が無効なのに連携ログインが有効なアカウントを無効に戻す
export class OauthLoginRequiresTwoFactor1793108117031 {
    name = 'OauthLoginRequiresTwoFactor1793108117031';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "user_profile" SET "useOauthLogin" = false WHERE "useOauthLogin" = true AND "twoFactorEnabled" = false`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // データの掃除だけなので戻さない(戻すと2段階認証なしで連携ログインできる状態に戻ってしまう)
    }
}
