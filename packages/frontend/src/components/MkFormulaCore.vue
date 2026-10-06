<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<!-- eslint-disable vue/no-v-html -->
<div v-if="block && !compiled.failed" v-html="compiled.html"></div>
<span v-else-if="!compiled.failed" v-html="compiled.html"></span>
<pre v-else-if="block">{{ formula }}</pre>
<code v-else>{{ formula }}</code>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import katex from 'katex';
// KaTeXのCSSはグローバルな固定クラス名(.katex等)に依存しており、CSS Modulesでスコープできない。
// このコンポーネントは動的import経由でしか読み込まれないため、非同期chunkとして遅延ロードされる。
import 'katex/dist/katex.min.css';
import { isFormulaTooComplex } from '@/utility/formula-safety.js';

const props = defineProps<{
	formula: string;
	block: boolean;
}>();

const compiled = computed((): { html: string; failed: boolean } => {
	// JUICE: ブラウザのタブをフリーズ・クラッシュさせうる複雑すぎる数式はレンダリングを試みない
	// (詳細は utility/formula-safety.ts のコメント参照)
	if (isFormulaTooComplex(props.formula)) {
		return { html: '', failed: true };
	}

	try {
		// throwOnError: false でも KaTeX 内部の ParseError 以外(スタックオーバーフロー等)は
		// 素通しされうるため、html を確定できた場合だけ v-html に渡す。失敗時は formula を
		// テキスト補間(自動エスケープ)で表示し、未検証のTeX文字列がHTMLとして注入されないようにする。
		return {
			html: katex.renderToString(props.formula, {
				// JUICE: ブロックの数式(\[...\])は、ディスプレイ数式(中央寄せ・大きい演算子・上下の添字)として組む
				displayMode: props.block,
				throwOnError: false,
				strict: true,
				// リモートから届く未検証のTeX入力をレンダリングするため、
				// \href 等の危険なコマンドは常に無効化する。
				trust: false,
				// \rule{999em}{999em} 等の巨大サイズ指定でタイムラインのレイアウトを
				// 埋め尽くされないよう、サイズ指定を最大20emに制限する(既定はInfinity)。
				maxSize: 20,
			}),
			failed: false,
		};
	} catch {
		return { html: '', failed: true };
	}
});
</script>
