/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 作ったばかりの絵チャの部屋のid(部屋の一覧から、部屋の画面への受け渡し)。
// 描く人として参加している部屋でも、入り直したとき(ページを開き直した・ほかのページから戻った)は見学中から始めて、
// 「描き始める」を押してから描けるようにする(うっかり描いてしまわないように)。部屋を作った直後だけは、
// そのまま描けるよう、ここに入れておく。部屋の画面は、開いたときに1回だけ受け取って消す
export const activeDrawRoomIds = new Set<string>();
