/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャの部屋のページ(ログインしていない人も見られる部屋だけ)のOGP
import type { CommonProps } from '@/server/web/views/_.js';
import { Layout } from '@/server/web/views/base.js';

export function DrawRoomPage(props: CommonProps<{
	room: {
		id: string;
		title: string;
		cw: string | null;
		ownerName: string;
		ownerUsername: string;
		drawerCount: number;
		isEnded: boolean;
	};
	// 注意書き(CW)の部屋では絵を出さない(null)
	image: { url: string; width: number; height: number } | null;
}>) {
	const title = props.room.title;
	const owner = `${props.room.ownerName} (@${props.room.ownerUsername})`;
	const description = props.room.cw != null
		? `⚠ ${props.room.cw} — 🎨 ${owner}`
		: `🎨 ${owner}${props.room.isEnded ? '' : ` · ✏️ ${props.room.drawerCount}`}`;

	function ogBlock() {
		return (
			<>
				<meta property="og:type" content="article" />
				<meta property="og:title" content={title} />
				<meta property="og:description" content={description} />
				<meta property="og:url" content={`${props.config.url}/draw/${props.room.id}`} />
				{props.image != null ? (
					<>
						<meta property="og:image" content={props.image.url} />
						<meta property="og:image:width" content={props.image.width.toString()} />
						<meta property="og:image:height" content={props.image.height.toString()} />
						<meta property="twitter:card" content="summary_large_image" />
					</>
				) : (
					<meta property="twitter:card" content="summary" />
				)}
			</>
		);
	}

	return (
		<Layout
			{...props}
			title={`${title} | ${props.instanceName}`}
			desc={description}
			ogSlot={ogBlock()}
		>
		</Layout>
	);
}
