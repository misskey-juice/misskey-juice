/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDrawRoom } from './DrawRoom.js';

// JUICE: 1本の線。pointsは点の列をバイナリに詰めてbase64にしたもの(形式は DrawRoomService の decodeDrawPoints を参照)
export type DrawStroke = {
	id: string;
	// JUICE: fillは塗りつぶし(囲って塗る・バケツ)。pointsは多角形の頂点で、筆圧の値が0の点から次の輪郭が始まる
	// (穴のある形も、偶奇規則で塗る)
	tool: 'pen' | 'eraser' | 'fill';
	color: string;
	size: number;
	// 不透明度(0.05〜1)。無ければ1(以前に描かれた線)
	opacity?: number;
	// JUICE: 筆の種類。softはにじみ筆(ふちのぼけた筆跡を重ねる)、dotはドット(画素単位でくっきり描く)。無ければ普通の筆。
	// areaは消しゴムで囲った範囲を消すもの(pointsはfillと同じ多角形)。ペンで囲って塗るのはtool: 'fill'
	brush?: 'soft' | 'dot' | 'area';
	// JUICE: 線の中だけ塗る(はみ出し防止)で、この線が塗れる範囲の多角形(pointsと同じ形式。印が0の点から次の輪郭)
	clip?: string;
	// JUICE: 移動ツールでずらした量(キャンバス座標)。点の列はそのままにして、描くときにこの分ずらす
	dx?: number;
	dy?: number;
	// JUICE: 描いた人のどのレイヤーの線か(DrawLayerMetaのid)。無ければ最初のレイヤー('0')
	layer?: string;
	// JUICE: 透明度ロック(その時点でレイヤーに描いてある所にだけ描く)。消しゴムには使わない
	lock?: boolean;
	points: string;
};

// JUICE: レイヤーの合成モード(CanvasのglobalCompositeOperationの名前)。無ければ通常
export const DRAW_LAYER_BLENDS = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter'] as const;
export type DrawLayerBlend = typeof DRAW_LAYER_BLENDS[number];

// JUICE: 1人が持つレイヤー(1人で複数持てる)。表示・濃さ・重なり順は、ほかの人の画面にも反映される
export type DrawLayerMeta = {
	id: string;
	name: string;
	visible: boolean;
	opacity: number;
	// JUICE: 下描き(描いた本人の画面にだけ見える)。線もレイヤー自体も、ほかの人には配らない。保存する画像にも入らない
	private?: boolean;
	// JUICE: 合成モード(乗算・焼き込みカラーなど)。無ければ通常
	blend?: DrawLayerBlend;
};

// レイヤーの一覧を持っていない人(以前に描かれた部屋を含む)は、最初のレイヤー1枚だけ
export const DEFAULT_DRAW_LAYERS: DrawLayerMeta[] = [{ id: '0', name: '', visible: true, opacity: 1 }];

/**
 * JUICE: 終了後も保存する(keepAfterEnd)絵チャの部屋で、ユーザーごとのレイヤーの線をDBに残したもの。
 * 開催中の線はRedisにあり、ここには入らない。
 */
@Entity('draw_room_layer')
@Index(['roomId', 'userId'], { unique: true })
export class MiDrawRoomLayer {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public roomId: MiDrawRoom['id'];

	@ManyToOne(() => MiDrawRoom, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public room: MiDrawRoom | null;

	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('jsonb', {
		default: [],
	})
	public strokes: DrawStroke[];

	// JUICE: その人のレイヤーの一覧(重なり順は下から)。無ければ最初のレイヤー1枚だけ
	@Column('jsonb', {
		nullable: true,
	})
	public layers: DrawLayerMeta[] | null;
}
