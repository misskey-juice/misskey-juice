<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 絵チャ(お絵かきチャット)の部屋 -->
<template>
<PageWithHeader :actions="headerActions">
	<MkLoading v-if="room == null && error == null"/>
	<MkError v-else-if="error != null" @retry="init()"/>
	<!-- JUICE: デッキ・ウインドウの中でも崩れないよう、画面全体ではなくこの枠の大きさで表示を切り替える -->
	<div v-else-if="room != null" ref="frameEl" :class="$style.frame">
	<div :class="$style.root">
		<div :class="$style.main">
			<!-- 参加状態・終了後の操作 -->
			<div :class="$style.status">
				<template v-if="room.isEnded">
					<div :class="$style.statusText"><i class="ti ti-archive"></i> {{ room.keepAfterEnd ? i18n.ts._drawRoom.ended : deletesInMinutes == null ? i18n.ts._drawRoom.endedNotKept : deletesInMinutes > 0 ? i18n.tsx._drawRoom.endedNotKeptRemaining({ n: deletesInMinutes }) : i18n.ts._drawRoom.endedNotKeptSoon }}</div>
					<div :class="$style.statusButtons">
						<MkButton small @click="saveImageToDrive()"><i class="ti ti-cloud-upload"></i> {{ i18n.ts._drawRoom.saveImage }}</MkButton>
						<MkButton small @click="postImage()"><i class="ti ti-pencil"></i> {{ i18n.ts._drawRoom.postImage }}</MkButton>
						<MkButton small @click="downloadImage()"><i class="ti ti-download"></i> {{ i18n.ts._drawRoom.downloadImage }}</MkButton>
						<MkButton small @click="startSelecting"><i class="ti ti-crop"></i> {{ i18n.ts._drawRoom.selectArea }}</MkButton>
						<!-- JUICE: 保存しないで終了した部屋も、削除される時間を待たずに部屋主が消せる -->
						<MkButton v-if="isOwner" small danger @click="deleteRoom(room.keepAfterEnd ? undefined : i18n.ts._drawRoom.deleteRoomNowConfirm)"><i class="ti ti-trash"></i> {{ i18n.ts._drawRoom.deleteRoom }}</MkButton>
					</div>
				</template>
				<!-- JUICE: モデレーターが公開範囲の外から確認のために開いている(見るだけ) -->
				<template v-else-if="room.viewOnly">
					<div :class="$style.statusText"><i class="ti ti-shield"></i> {{ i18n.ts._drawRoom.viewingAsModerator }}</div>
				</template>
				<template v-else-if="!room.isMember">
					<div :class="$style.statusText"><i class="ti ti-eye"></i> {{ isFull ? i18n.ts._drawRoom.full : i18n.ts._drawRoom.spectating }}</div>
					<MkButton v-if="!isFull" small primary @click="join"><i class="ti ti-brush"></i> {{ i18n.ts._drawRoom.join }}</MkButton>
				</template>
				<template v-else>
					<!-- ツール -->
					<div :class="$style.tools">
						<button v-tooltip="i18n.ts._drawRoom.pen" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'pen' }]" :aria-label="i18n.ts._drawRoom.pen" :aria-pressed="tool === 'pen'" @click="tool = 'pen'"><i class="ti ti-pencil"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.pen }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.eraser" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'eraser' }]" :aria-label="i18n.ts._drawRoom.eraser" :aria-pressed="tool === 'eraser'" @click="tool = 'eraser'"><i class="ti ti-eraser"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.eraser }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.eyedropperHint" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'eyedropper' }]" :aria-label="i18n.ts._drawRoom.eyedropper" :aria-pressed="tool === 'eyedropper'" @click="tool = 'eyedropper'"><i class="ti ti-color-picker"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.eyedropper }}</span></button>
						<!-- JUICE: 自分の線を範囲・投げ縄で選び、移動ツールでずらす(選んでいなければレイヤー全体) -->
						<button v-tooltip="i18n.ts._drawRoom.selectRect" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'select' }]" :aria-label="i18n.ts._drawRoom.selectRect" :aria-pressed="tool === 'select'" @click="tool = 'select'"><i class="ti ti-marquee-2"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortSelect }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.selectLasso" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'lasso' }]" :aria-label="i18n.ts._drawRoom.selectLasso" :aria-pressed="tool === 'lasso'" @click="tool = 'lasso'"><i class="ti ti-lasso"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortLasso }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.moveToolHint" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'move' }]" :aria-label="i18n.ts._drawRoom.moveTool" :aria-pressed="tool === 'move'" @click="tool = 'move'"><i class="ti ti-arrows-move"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.moveTool }}</span></button>
						<!-- JUICE: 手のひらツール(線は動かさず、表示だけを動かす) -->
						<button v-tooltip="i18n.ts._drawRoom.handToolHint" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'hand' }]" :aria-label="i18n.ts._drawRoom.handTool" :aria-pressed="tool === 'hand'" @click="tool = 'hand'"><i class="ti ti-hand-grab"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.handTool }}</span></button>
						<!-- JUICE: バケツ(塗りつぶし)。囲って塗るのは筆の種類の1つ(ペンなら塗る、消しゴムなら消す) -->
						<button v-tooltip="i18n.ts._drawRoom.bucketFill" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: tool === 'bucket' }]" :aria-label="i18n.ts._drawRoom.bucketFill" :aria-pressed="tool === 'bucket'" @click="tool = 'bucket'"><i class="ti ti-bucket-droplet"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortBucket }}</span></button>
						<!-- JUICE: スマホでは色・太さ・濃さをまとめたボタンにし、押すとキャンバスの上に選ぶ欄を出す -->
						<button
							class="_button"
							:class="[$style.brushButton, { [$style.toolButtonActive]: brushPanelOpen }]"
							:aria-label="`${i18n.ts._drawRoom.color} / ${i18n.ts._drawRoom.size}`"
							:aria-expanded="brushPanelOpen"
							@click="brushPanelOpen = !brushPanelOpen"
						>
							<span :class="$style.brushPreview" :style="{ background: color, opacity: opacity / 100 }"></span>
							<span v-if="usesBrushSize" :class="$style.sizeValue">{{ sizePercent }}%</span>
						</button>
						<div :class="[$style.brushOptions, { [$style.brushOptionsOpen]: brushPanelOpen }]">
						<span :class="$style.toolSeparator"></span>
						<button
							v-for="c in PALETTE"
							:key="c"
							v-tooltip="c"
							class="_button"
							:class="[$style.swatch, { [$style.swatchActive]: color === c }]"
							:style="{ background: c }"
							:aria-label="`${i18n.ts._drawRoom.color}: ${c}`"
							:aria-pressed="color === c"
							@click="color = c"
						></button>
						<!-- JUICE: カラーパレット(色相の輪・保存した色・最近使った色・コードや数値) -->
						<button
							v-tooltip="i18n.ts._drawRoom.colorPalette"
							class="_button"
							:class="$style.colorButton"
							:aria-label="`${i18n.ts._drawRoom.colorPalette}: ${color}`"
							@click="openColorPicker"
						><span :class="$style.colorButtonSwatch" :style="{ background: color }"></span><i class="ti ti-palette"></i></button>
						<!-- JUICE: 太さ・濃さ・筆の種類は、それを使う道具のときだけ出す(スポイト・選択・移動などでは出さない) -->
						<span v-if="usesBrushSize || usesOpacity" :class="$style.toolSeparator"></span>
						<label v-if="usesBrushSize" :class="$style.sizeLabel">
							<i class="ti ti-line-dashed"></i>
							<input v-model.number="sizePercent" type="range" min="1" max="100" step="1" :aria-label="i18n.ts._drawRoom.size" :aria-valuetext="`${sizePercent}% (${Math.round(size * 10) / 10}px)`"/>
							<span v-tooltip="`${Math.round(size * 10) / 10}px`" :class="$style.sizeValue">{{ sizePercent }}%</span>
						</label>
						<label v-if="usesOpacity" v-tooltip="i18n.ts._drawRoom.opacity" :class="$style.sizeLabel">
							<i class="ti ti-droplet-half-2"></i>
							<input v-model.number="opacity" type="range" min="5" max="100" step="5" :aria-label="i18n.ts._drawRoom.opacity"/>
							<span :class="$style.sizeValue">{{ opacity }}%</span>
						</label>
						<!-- JUICE: 筆の種類(普通・にじみ・ドット・囲って塗る)と、線の中だけ塗る(はみ出し防止) -->
						<template v-if="usesBrushSize">
						<span :class="$style.toolSeparator"></span>
						<button v-tooltip="i18n.ts._drawRoom.brushNormal" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: brushType === 'normal' }]" :aria-label="i18n.ts._drawRoom.brushNormal" :aria-pressed="brushType === 'normal'" @click="brushType = 'normal'"><i class="ti ti-brush"></i></button>
						<button v-tooltip="i18n.ts._drawRoom.brushSoft" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: brushType === 'soft' }]" :aria-label="i18n.ts._drawRoom.brushSoft" :aria-pressed="brushType === 'soft'" @click="brushType = 'soft'"><i class="ti ti-droplet"></i></button>
						<button v-tooltip="i18n.ts._drawRoom.brushDot" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: brushType === 'dot' }]" :aria-label="i18n.ts._drawRoom.brushDot" :aria-pressed="brushType === 'dot'" @click="brushType = 'dot'"><i class="ti ti-grid-dots"></i></button>
						<button v-tooltip="i18n.ts._drawRoom.brushAreaHint" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: brushType === 'area' }]" :aria-label="i18n.ts._drawRoom.lassoFill" :aria-pressed="brushType === 'area'" @click="brushType = 'area'"><i class="ti ti-lasso-polygon"></i></button>
						<button v-tooltip="i18n.ts._drawRoom.clipToLinesHint" class="_button" :class="[$style.toolButton, { [$style.toolButtonActive]: clipToLines }]" :aria-label="i18n.ts._drawRoom.clipToLines" :aria-pressed="clipToLines" @click="clipToLines = !clipToLines"><i class="ti ti-shape"></i></button>
						</template>
						<!-- JUICE: 筆圧で太さ・濃さを変えるか(ペン・消しゴム。囲って塗るときは使わない) -->
						<template v-if="usesBrushSize && brushType !== 'area'">
						<button
							v-tooltip="i18n.ts._drawRoom.pressureSizeHint"
							class="_button"
							:class="[$style.toolButton, { [$style.toolButtonActive]: pressureSize }]"
							:aria-label="i18n.ts._drawRoom.pressureSize"
							:aria-pressed="pressureSize"
							@click="pressureSize = !pressureSize"
						><i class="ti ti-line-height"></i></button>
						<button
							v-if="brushType !== 'dot'"
							v-tooltip="i18n.ts._drawRoom.pressureOpacityHint"
							class="_button"
							:class="[$style.toolButton, { [$style.toolButtonActive]: pressureOpacity }]"
							:aria-label="i18n.ts._drawRoom.pressureOpacity"
							:aria-pressed="pressureOpacity"
							@click="pressureOpacity = !pressureOpacity"
						><i class="ti ti-droplet-half-2"></i></button>
						</template>
						<!-- JUICE: 透明度ロック(ペン・塗りつぶしのとき。消しゴムには効かない) -->
						<button
							v-if="(usesBrushSize && tool !== 'eraser') || tool === 'bucket'"
							v-tooltip="i18n.ts._drawRoom.alphaLockHint"
							class="_button"
							:class="[$style.toolButton, { [$style.toolButtonActive]: alphaLock }]"
							:aria-label="i18n.ts._drawRoom.alphaLock"
							:aria-pressed="alphaLock"
							@click="alphaLock = !alphaLock"
						><i class="ti ti-lock-square"></i></button>
						<!-- JUICE: 隙間閉じ(塗りつぶしと、線の中だけ塗るとき) -->
						<template v-if="tool === 'bucket' || (usesBrushSize && clipToLines)">
						<span v-if="!usesBrushSize" :class="$style.toolSeparator"></span>
						<button
							v-tooltip="i18n.ts._drawRoom.gapCloseHint"
							class="_button"
							:class="[$style.toolButton, { [$style.toolButtonActive]: gapClose !== 'off' }]"
							:aria-label="`${i18n.ts._drawRoom.gapClose}: ${gapCloseLabel(gapClose)}`"
							@click="openGapCloseMenu"
						><i class="ti ti-arrows-join-2"></i><span :class="$style.toolLabel">{{ gapCloseLabel(gapClose) }}</span></button>
						</template>
						</div>
						<span :class="$style.toolSeparator"></span>
						<button v-tooltip="i18n.ts._drawRoom.undo" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._drawRoom.undo" @click="undo"><i class="ti ti-arrow-back-up"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortUndo }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.redo" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._drawRoom.redo" @click="redo"><i class="ti ti-arrow-forward-up"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortRedo }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.clearMyLayer" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._drawRoom.clearMyLayer" @click="clearMyLayer"><i class="ti ti-trash"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortClear }}</span></button>
					</div>
					<!-- JUICE: 部屋主も描く人から抜けて観戦できる(部屋主のまま) -->
					<MkButton small @click="leave">{{ isOwner ? i18n.ts._drawRoom.spectateAsOwner : i18n.ts._drawRoom.leave }}</MkButton>
				</template>
				<!-- JUICE: スマホでは、レイヤーとチャットを下から出すパネルにする -->
				<div :class="$style.statusEnd">
				<!-- JUICE: 開催中・終了後どちらでも、全体または選んだ範囲を画像(PNG)にして保存・投稿できる -->
				<button
					v-tooltip="i18n.ts._drawRoom.imageMenu"
					class="_button"
					:class="[$style.toolButton, { [$style.toolButtonActive]: selecting }]"
					:aria-label="i18n.ts._drawRoom.imageMenu"
					@click="openImageMenu"
				><i class="ti ti-photo-down"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.shortImage }}</span></button>
				<div :class="$style.sheetButtons">
					<button
						class="_button"
						:class="[$style.toolButton, { [$style.toolButtonActive]: mobilePanel === 'layers' }]"
						:aria-label="i18n.ts._drawRoom.layers"
						:aria-pressed="mobilePanel === 'layers'"
						@click="toggleMobilePanel('layers')"
					><i class="ti ti-stack-2"></i><span :class="$style.toolLabel">{{ i18n.ts._drawRoom.layers }}</span></button>
					<button
						class="_button"
						:class="[$style.toolButton, { [$style.toolButtonActive]: mobilePanel === 'chat' }]"
						:aria-label="i18n.ts._drawRoom.chat"
						:aria-pressed="mobilePanel === 'chat'"
						@click="toggleMobilePanel('chat')"
					>
						<i class="ti ti-messages"></i>
						<span :class="$style.toolLabel">{{ i18n.ts._drawRoom.chat }}</span>
						<span v-if="chatUnread" :class="$style.unreadDot"></span>
					</button>
				</div>
				</div>
			</div>

			<!-- キャンバス。拡大縮小・移動はCSSのtransformで行い、座標は表示上の大きさから逆算する -->
			<div
				ref="viewportEl"
				:class="$style.viewport"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
				@pointercancel="onPointerUp"
				@pointerleave="onPointerLeave"
				@wheel.prevent="onWheel"
				@contextmenu.prevent
			>
				<!-- JUICE: 注意書き(CW)・センシティブ(NSFW)の部屋は、開くと決めるまで絵を隠す -->
				<div v-if="contentGated && room != null" :class="$style.contentGate" @pointerdown.stop @pointermove.stop @pointerup.stop @wheel.stop>
					<i class="ti ti-eye-exclamation" :class="$style.contentGateIcon"></i>
					<div v-if="room.isSensitive" :class="$style.contentGateBadge">{{ i18n.ts._drawRoom.roomSensitiveBadge }}</div>
					<div v-if="room.cw != null" :class="$style.contentGateCw">{{ room.cw }}</div>
					<div v-else :class="$style.contentGateText">{{ i18n.ts._drawRoom.roomSensitiveGate }}</div>
					<MkButton primary rounded @click="acceptContent"><i class="ti ti-eye"></i> {{ i18n.ts._drawRoom.openRoomContent }}</MkButton>
				</div>
				<!-- JUICE: 線の読み込み中(線が多い部屋では時間がかかる)は、キャンバスの上に進み具合を出す -->
				<div v-if="canvasLoading != null" :class="$style.canvasLoading" role="status">
					<MkLoading/>
					<div>{{ i18n.ts._drawRoom.loadingCanvas }}<template v-if="canvasLoading.total > 0"> ({{ canvasLoading.done }} / {{ canvasLoading.total }})</template></div>
				</div>
				<!-- JUICE: 表示用のキャンバスの上に、描いている途中のペンの線を描くキャンバス(不透明・半透明)を重ねる -->
				<div :class="[$style.canvasStack, { [$style.canvasStackPixelated]: dotView }]" :style="{ '--px': `${1 / view.scale}`, transform: `translate(${view.x}px, ${view.y}px) rotate(${view.rotation}rad) scale(${view.scale})` }">
					<canvas
						ref="canvasEl"
						:class="[$style.canvas, {
							[$style.canvasDrawable]: canDraw,
							[$style.canvasPicking]: canDraw && tool === 'eyedropper',
							[$style.canvasMove]: canDraw && tool === 'move',
							[$style.canvasPan]: spaceHeld || (canDraw && tool === 'hand'),
							[$style.canvasPetting]: petting && !spaceHeld,
						}]"
					></canvas>
					<canvas ref="overlayEl" :class="$style.canvasOverlay"></canvas>
					<canvas ref="overlayAlphaEl" :class="$style.canvasOverlay"></canvas>
					<!-- JUICE: ピクセルアート拡大モードで大きく拡大したときの、画素の境目の薄い格子 -->
					<svg v-if="room != null && showPixelGrid" :class="$style.canvasOverlay" :viewBox="`0 0 ${room.canvasWidth} ${room.canvasHeight}`" aria-hidden="true">
						<path :d="pixelGridPath" :class="$style.pixelGrid" :stroke-opacity="pixelGridOpacity"/>
					</svg>
					<!-- JUICE: 選んでいる線の範囲と、投げ縄・範囲選択の途中の線 -->
					<svg v-if="room != null && (selectionShapes.length > 0 || selectGesture != null || fillGesture != null || (selecting && selection != null))" :class="$style.canvasOverlay" :viewBox="`0 0 ${room.canvasWidth} ${room.canvasHeight}`" aria-hidden="true">
						<!-- 選んだときに囲んだ形(範囲・投げ縄)のまま表示し、移動ツールでずらしている間は一緒に動かす -->
						<g :transform="`translate(${moveOffset.x} ${moveOffset.y}) rotate(${rotateDragAngle * 180 / Math.PI} ${selectionPivot?.x ?? 0} ${selectionPivot?.y ?? 0})`">
							<polygon v-for="(shape, i) in selectionShapes" :key="i" :points="toSvgPoints(shape)" :class="$style.selectionOutline"/>
							<!-- JUICE: ドラッグして選んだ部分を回転するつまみ -->
							<template v-if="selectionBox != null && canDraw">
								<line :x1="selectionBox.cx" :y1="selectionBox.minY" :x2="selectionBox.cx" :y2="selectionBox.minY - 28 / view.scale" :class="$style.selectionOutline"/>
								<circle
									:cx="selectionBox.cx"
									:cy="selectionBox.minY - 28 / view.scale"
									:r="9 / view.scale"
									:class="$style.rotateHandle"
									@pointerdown.stop.prevent="onRotateHandleDown"
									@pointermove.stop="onRotateHandleMove"
									@pointerup.stop="onRotateHandleUp"
									@pointercancel.stop="onRotateHandleUp"
								/>
							</template>
						</g>
						<!-- 囲って塗っている途中の形 -->
						<polygon v-if="fillGesture != null" :points="toSvgPoints(fillGesture.points)" :fill="color" :fill-opacity="opacity / 100 * 0.6" :class="$style.selectionOutline"/>
						<polygon v-if="selectGesture != null" :points="toSvgPoints(selectGestureShape)" :class="$style.selectionOutline"/>
						<!-- 保存する範囲(キャンバスと一緒に回転・拡大縮小する) -->
						<rect v-if="selecting && selection != null" :x="selection.x" :y="selection.y" :width="selection.width" :height="selection.height" :class="$style.selectionOutline"/>
					</svg>
				</div>
				<!-- JUICE: デバッグ情報(表示のメニューでオンにしたとき) -->
				<div v-if="showDebugInfo && debugInfo != null && room != null" :class="$style.debugInfo" aria-hidden="true">
					<div>{{ i18n.ts._drawRoom.debugMyStrokes }}: {{ debugInfo.myStrokes }} / {{ strokeLimits.strokes }}</div>
					<div>{{ i18n.ts._drawRoom.debugMyBytes }}: ≈{{ formatMegabytes(debugInfo.myBytes) }} / {{ strokeLimits.megabytes }}MB</div>
					<template v-if="debugInfo.layers.length > 1">
						<div v-for="(layer, i) in debugInfo.layers" :key="i">&nbsp;&nbsp;{{ layer.name }}: {{ layer.strokes }}</div>
					</template>
					<div>{{ i18n.ts._drawRoom.debugRoomStrokes }}: {{ debugInfo.roomStrokes }} ({{ debugInfo.roomLayers }} {{ i18n.ts._drawRoom.debugLayers }})</div>
					<div>{{ i18n.ts._drawRoom.debugPending }}: {{ debugInfo.pending }}</div>
					<div>{{ i18n.ts._drawRoom.debugCanvas }}: {{ room.canvasWidth }}×{{ room.canvasHeight }} / {{ Math.round(view.scale * 100) }}% / {{ rotationDegrees }}°</div>
					<div>{{ i18n.ts._drawRoom.debugRedraw }}: {{ debugInfo.lastRedrawMs.toFixed(1) }}ms ({{ debugInfo.lastRedrawFull ? i18n.ts._drawRoom.debugRedrawFull : i18n.ts._drawRoom.debugRedrawRegion }})</div>
					<div>{{ i18n.ts._drawRoom.debugRender }}: {{ debugInfo.lastRenderMs.toFixed(1) }}ms</div>
					<div>{{ i18n.ts._drawRoom.debugOnline }}: {{ onlineUserIds.size }}</div>
				</div>
				<!-- JUICE: ほかの人のカーソル(位置の点と、丸いアイコン) -->
				<!-- 表示・濃さは、表示のメニューで変えられる(このブラウザに覚える) -->
				<template v-if="showCursors">
				<div
					v-for="[userId, cursor] in cursors"
					:key="userId"
					:class="$style.cursor"
					:style="{ transform: `translate(${canvasToView(cursor.x, cursor.y)[0]}px, ${canvasToView(cursor.x, cursor.y)[1]}px)`, opacity: cursorOpacity }"
				>
					<!-- JUICE: なでているときは、点の代わりに手を出す -->
					<i v-if="cursor.pet" class="ti ti-hand-stop" :class="$style.cursorHand"></i>
					<span v-else :class="$style.cursorDot"></span>
					<MkAvatar v-if="userMap.get(userId)" :class="$style.cursorAvatar" :user="userMap.get(userId)!"/>
				</div>
				</template>
				<!-- JUICE: なでたところに出るハート(自分のなでた分も出す) -->
				<i
					v-for="heart in petHearts"
					:key="heart.id"
					class="ti ti-heart-filled"
					:class="$style.petHeart"
					:style="{ transform: `translate(${canvasToView(heart.x, heart.y)[0]}px, ${canvasToView(heart.x, heart.y)[1]}px)`, '--petHeartDrift': `${heart.drift}px` }"
					aria-hidden="true"
				></i>
				<!-- JUICE: 選んでいる線の操作 -->
				<div v-if="strokeSelection.size > 0 && !selecting" :class="$style.selectionBar" @pointerdown.stop @pointermove.stop @pointerup.stop>
					<span :class="$style.selectionHint">{{ i18n.tsx._drawRoom.selectedStrokes({ n: strokeSelection.size }) }}</span>
					<button class="_button" :class="$style.selectionAction" @click="tool = 'move'"><i class="ti ti-arrows-move"></i> {{ i18n.ts._drawRoom.moveTool }}</button>
					<button v-tooltip="i18n.ts._drawRoom.rotateSelectionLeft" class="_button" :class="$style.selectionAction" :aria-label="i18n.ts._drawRoom.rotateSelectionLeft" @click="rotateSelection(-ROTATE_STEP)"><i class="ti ti-rotate-2"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.rotateLeft }}</span></button>
					<button v-tooltip="i18n.ts._drawRoom.rotateSelectionRight" class="_button" :class="$style.selectionAction" :aria-label="i18n.ts._drawRoom.rotateSelectionRight" @click="rotateSelection(ROTATE_STEP)"><i class="ti ti-rotate-clockwise-2"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.rotateRight }}</span></button>
					<button class="_button" :class="$style.selectionAction" @click="deleteSelectedStrokes"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</button>
					<button v-tooltip="i18n.ts._drawRoom.clearSelection" class="_button" :class="$style.selectionAction" :aria-label="i18n.ts._drawRoom.clearSelection" @click="clearStrokeSelection"><i class="ti ti-x"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.shortDeselect }}</span></button>
				</div>
				<!-- JUICE: 保存する範囲の選択 -->
				<div v-if="selecting" :class="$style.selectionBar" @pointerdown.stop @pointermove.stop @pointerup.stop>
					<span v-if="selection == null || selection.width < 1" :class="$style.selectionHint"><i class="ti ti-crop"></i> {{ i18n.ts._drawRoom.selectAreaHint }}</span>
					<template v-else>
						<span :class="$style.selectionHint">{{ selection.width }}×{{ selection.height }}</span>
						<select v-model="imageFormat" :class="$style.selectionFormat" :aria-label="i18n.ts._drawRoom.imageFormat">
							<option v-for="option in imageFormatOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
						</select>
						<button class="_button" :class="$style.selectionAction" @click="saveImageToDrive(selection)"><i class="ti ti-cloud-upload"></i> {{ i18n.ts._drawRoom.saveImage }}</button>
						<button class="_button" :class="$style.selectionAction" @click="postImage(selection)"><i class="ti ti-pencil"></i> {{ i18n.ts._drawRoom.postImage }}</button>
						<button class="_button" :class="$style.selectionAction" @click="downloadImage(selection)"><i class="ti ti-download"></i> {{ i18n.ts._drawRoom.downloadImage }}</button>
					</template>
					<button v-tooltip="i18n.ts.cancel" class="_button" :class="$style.selectionAction" :aria-label="i18n.ts.cancel" @click="cancelSelecting"><i class="ti ti-x"></i></button>
				</div>
				<!-- JUICE: 全体マップ。今表示している範囲を枠で示し、押した・なぞった位置へ表示を移す -->
				<div :class="$style.minimap" @pointerdown.stop @pointermove.stop @pointerup.stop @wheel.stop.prevent>
					<div
						v-show="showMinimap && !contentGated"
						:class="$style.minimapBody"
						:style="{ width: `${minimapSize.width}px`, height: `${minimapSize.height}px` }"
						role="img"
						:aria-label="i18n.ts._drawRoom.minimap"
						@pointerdown="onMinimapPointerDown"
						@pointermove="onMinimapPointerMove"
						@pointerup="onMinimapPointerUp"
						@pointercancel="onMinimapPointerUp"
					>
						<canvas ref="minimapEl" :class="[$style.minimapCanvas, { [$style.minimapCanvasPixelated]: dotView }]" :width="minimapSize.width" :height="minimapSize.height"></canvas>
						<svg v-if="room != null" :class="$style.minimapFrame" :viewBox="`0 0 ${room.canvasWidth} ${room.canvasHeight}`" preserveAspectRatio="none" aria-hidden="true">
							<polygon :points="minimapFramePoints"/>
						</svg>
					</div>
					<div :class="$style.minimapBar">
						<!-- JUICE: なでるツール(見学者も使える。絵は変わらず、なでているのがほかの人に見える) -->
						<button
							v-if="canPet"
							v-tooltip="i18n.ts._drawRoom.petToolHint"
							class="_button"
							:class="[$style.minimapToggle, { [$style.minimapToggleActive]: petting }]"
							:aria-label="i18n.ts._drawRoom.petTool"
							:aria-pressed="petting"
							@click="petting = !petting"
						><i class="ti ti-hand-stop"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.petTool }}</span></button>
						<!-- JUICE: キャンバスの回転(PC向け。スマホ・タブレットは2本指で回せる) -->
						<button v-tooltip="i18n.ts._drawRoom.rotateLeft" class="_button" :class="$style.minimapToggle" :aria-label="i18n.ts._drawRoom.rotateLeft" @click="rotateBy(-ROTATE_STEP)"><i class="ti ti-rotate-2"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.rotateLeft }}</span></button>
						<button v-if="rotationDegrees !== 0" v-tooltip="i18n.ts._drawRoom.resetRotation" class="_button" :class="$style.zoomLevel" :aria-label="i18n.ts._drawRoom.resetRotation" @click="resetRotation">{{ rotationDegrees }}°</button>
						<button v-tooltip="i18n.ts._drawRoom.rotateRight" class="_button" :class="$style.minimapToggle" :aria-label="i18n.ts._drawRoom.rotateRight" @click="rotateBy(ROTATE_STEP)"><i class="ti ti-rotate-clockwise-2"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.rotateRight }}</span></button>
						<button v-tooltip="i18n.ts._drawRoom.zoomOut" class="_button" :class="$style.minimapToggle" :aria-label="i18n.ts._drawRoom.zoomOut" @click="zoomBy(1 / ZOOM_STEP)"><i class="ti ti-minus"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.zoomOut }}</span></button>
						<!-- JUICE: 倍率はスライダーでも変えられる(倍率の段階が細かく感じられるよう、倍率の対数で動かす) -->
						<input v-model.number="zoomSlider" type="range" :min="ZOOM_SLIDER_MIN" :max="ZOOM_SLIDER_MAX" step="0.01" :class="$style.zoomSlider" :aria-label="i18n.ts._drawRoom.zoomLevel" :aria-valuetext="`${Math.round(view.scale * 100)}%`"/>
						<button v-tooltip="i18n.ts._drawRoom.zoomLevel" class="_button" :class="$style.zoomLevel" :aria-label="i18n.ts._drawRoom.zoomLevel" @click="openZoomMenu">{{ Math.round(view.scale * 100) }}%</button>
						<button v-tooltip="i18n.ts._drawRoom.zoomIn" class="_button" :class="$style.minimapToggle" :aria-label="i18n.ts._drawRoom.zoomIn" @click="zoomBy(ZOOM_STEP)"><i class="ti ti-plus"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.zoomIn }}</span></button>
						<!-- JUICE: ピクセルアート拡大モード(拡大しても画素をぼかさない。画像の拡大表示と同じもの) -->
						<button
							v-tooltip="i18n.ts.pixelatedZoom"
							class="_button"
							:class="[$style.minimapToggle, { [$style.minimapToggleActive]: dotView }]"
							:aria-label="i18n.ts.pixelatedZoom"
							:aria-pressed="dotView"
							@click="dotView = !dotView"
						><i class="ti ti-grid-dots"></i><span :class="$style.barLabel">{{ i18n.ts._drawRoom.shortPixel }}</span></button>
						<button
							v-tooltip="showMinimap ? i18n.ts._drawRoom.hideMinimap : i18n.ts._drawRoom.showMinimap"
							class="_button"
							:class="$style.minimapToggle"
							:aria-label="showMinimap ? i18n.ts._drawRoom.hideMinimap : i18n.ts._drawRoom.showMinimap"
							:aria-pressed="showMinimap"
							@click="showMinimap = !showMinimap"
						>
							<i class="ti ti-map"></i>
							<span :class="$style.barLabel">{{ i18n.ts._drawRoom.shortMinimap }}</span>
						</button>
						<!-- JUICE: 表示の設定 -->
						<button v-tooltip="i18n.ts._drawRoom.viewSettings" class="_button" :class="$style.minimapToggle" :aria-label="i18n.ts._drawRoom.viewSettings" @click="openViewMenu"><i class="ti ti-dots"></i></button>
					</div>
				</div>
			</div>
		</div>

		<!-- JUICE: しまったレイヤー・チャットを出すつまみ(右端) -->
		<button
			v-if="sideHidden"
			v-tooltip="i18n.ts._drawRoom.showSidePanel"
			class="_button"
			:class="$style.sideHandle"
			:aria-label="i18n.ts._drawRoom.showSidePanel"
			@click="sideHidden = false"
		><i class="ti ti-chevron-left"></i><i class="ti ti-stack-2"></i><i class="ti ti-messages"></i></button>
		<div
			:id="sideId"
			ref="sideEl"
			:class="[$style.side, { [$style.sideOpen]: mobilePanel != null, [$style.sideHidden]: sideHidden }]"
			:style="{ '--juiceSideWidth': `${sideWidth}px`, '--juiceLayersRatio': layersRatio }"
		>
			<!-- JUICE: 左端をドラッグしてパネルの幅を変える(PCだけ) -->
			<div
				:class="$style.sideResizer"
				role="separator"
				aria-orientation="vertical"
				tabindex="0"
				:aria-label="i18n.ts._drawRoom.resizeSidePanel"
				:aria-controls="sideId"
				:aria-valuenow="sideWidth"
				:aria-valuemin="SIDE_WIDTH_MIN"
				:aria-valuemax="SIDE_WIDTH_MAX"
				@pointerdown="startSideResize"
				@keydown.left.prevent="sideWidth = clampSideWidth(sideWidth + 20)"
				@keydown.right.prevent="sideWidth = clampSideWidth(sideWidth - 20)"
				@keydown.home.prevent="sideWidth = SIDE_WIDTH_MIN"
				@keydown.end.prevent="sideWidth = SIDE_WIDTH_MAX"
			></div>
			<!-- 描いている人・レイヤー -->
			<div :id="layersPanelId" class="_panel" :class="[$style.sidePanel, $style.layers, { [$style.sheetHidden]: mobilePanel !== 'layers' }]">
				<div :class="$style.sideHeader">
					<i class="ti ti-stack-2"></i> {{ i18n.ts._drawRoom.layers }} <span v-if="!room.isEnded" :class="$style.memberCount">{{ i18n.tsx._drawRoom.membersCount({ n: room.members.length, max: room.maxMembers }) }}</span>
					<!-- JUICE: PCでは、レイヤーとチャットをまとめて右へしまい、キャンバスを広く使える -->
					<button v-tooltip="i18n.ts._drawRoom.hideSidePanel" class="_button" :class="$style.sideHideButton" :aria-label="i18n.ts._drawRoom.hideSidePanel" @click="sideHidden = true"><i class="ti ti-layout-sidebar-right-collapse"></i></button>
					<button class="_button" :class="$style.sheetClose" :aria-label="i18n.ts.close" @click="mobilePanel = null"><i class="ti ti-x"></i></button>
				</div>
				<div v-if="!room.isEnded" :class="$style.onlineSummary"><span :class="$style.onlineDotInline"></span> {{ i18n.tsx._drawRoom.onlineCount({ n: onlineUserIds.size }) }}</div>
				<template v-for="userId in listedUserIds" :key="userId">
				<div :class="[$style.layerRow, { [$style.layerRowOffline]: !room.isEnded && !onlineUserIds.has(userId) }]">
					<!-- JUICE: 今この部屋を開いている人は緑の点、閉じている人は薄く表示する -->
					<span :class="$style.layerAvatarWrap">
						<MkAvatar v-if="userMap.get(userId)" :class="$style.layerAvatar" :user="userMap.get(userId)!"/>
						<span
							v-if="!room.isEnded"
							v-tooltip="onlineUserIds.has(userId) ? i18n.ts._drawRoom.online : i18n.ts._drawRoom.offline"
							:class="[$style.presenceDot, { [$style.presenceDotOnline]: onlineUserIds.has(userId) }]"
							role="img"
							:aria-label="onlineUserIds.has(userId) ? i18n.ts._drawRoom.online : i18n.ts._drawRoom.offline"
						></span>
					</span>
					<!-- JUICE: 名前が長くても、部屋主・描く人のアイコンは省略せずに出す -->
					<span :class="$style.layerIdentity">
						<span :class="$style.layerName"><MkUserName v-if="userMap.get(userId)" :user="userMap.get(userId)!"/></span>
						<i v-if="userId === room.ownerId" v-tooltip="i18n.ts._drawRoom.owner" class="ti ti-crown" :class="$style.ownerIcon" role="img" :aria-label="i18n.ts._drawRoom.owner"></i>
						<i v-if="!room.isEnded && room.members.some(m => m.id === userId)" v-tooltip="i18n.ts._drawRoom.members" class="ti ti-brush" :class="$style.drawingIcon" role="img" :aria-label="i18n.ts._drawRoom.members"></i>
					</span>
					<i v-if="!room.isEnded && !layerUserIds.includes(userId)" v-tooltip="i18n.ts._drawRoom.spectating" class="ti ti-eye" :class="$style.drawingIcon" role="img" :aria-label="i18n.ts._drawRoom.spectating"></i>
					<button
						v-if="layerUserIds.includes(userId)"
						v-tooltip="hiddenLayers.has(userId) ? i18n.ts.show : i18n.ts.hide"
						class="_button"
						:class="$style.layerButton"
						:aria-label="hiddenLayers.has(userId) ? i18n.ts.show : i18n.ts.hide"
						:aria-pressed="!hiddenLayers.has(userId)"
						@click="toggleLayer(userId)"
					><i :class="hiddenLayers.has(userId) ? 'ti ti-eye-off' : 'ti ti-eye'"></i></button>
					<button
						v-if="isOwner && !room.isEnded && userId !== room.ownerId && room.members.some(m => m.id === userId)"
						v-tooltip="i18n.ts._drawRoom.kick"
						class="_button"
						:class="$style.layerButton"
						:aria-label="i18n.ts._drawRoom.kick"
						@click="kick(userId)"
					><i class="ti ti-user-minus"></i></button>
					<button
						v-if="isOwner && !room.isEnded && userId !== $i.id && layerUserIds.includes(userId)"
						v-tooltip="i18n.ts._drawRoom.clearLayerOf"
						class="_button"
						:class="$style.layerButton"
						:aria-label="i18n.ts._drawRoom.clearLayerOf"
						@click="clearLayerOf(userId)"
					><i class="ti ti-eraser"></i></button>
				</div>
				<!-- JUICE: その人のレイヤー(上にあるものから)。自分のレイヤーは、選ぶ・追加・表示・名前・濃さ・並び(つまみをドラッグ)・削除ができる -->
				<div v-if="userId === $i.id && canDraw" :class="$style.subLayers">
					<MkDraggable
						:modelValue="myLayersTopFirst"
						direction="vertical"
						manualDragStart
						@update:modelValue="reorderMyLayers"
					>
						<template #default="{ item: meta, dragStart }">
							<div :class="[$style.subLayer, { [$style.subLayerActive]: meta.id === activeLayerId, [$style.subLayerHidden]: !meta.visible }]">
								<button
									v-if="myLayers.length > 1"
									v-tooltip="i18n.ts._drawRoom.reorderLayer"
									class="_button"
									:class="$style.layerGrip"
									:aria-label="i18n.ts._drawRoom.reorderLayer"
									@pointerdown="dragStart"
									@keydown.up.prevent="moveMyLayer(meta.id, 1)"
									@keydown.down.prevent="moveMyLayer(meta.id, -1)"
								><i class="ti ti-grip-vertical"></i></button>
								<button
									class="_button"
									:class="$style.subLayerName"
									:aria-pressed="meta.id === activeLayerId"
									@click="activeLayerId = meta.id"
								>{{ layerName($i.id, meta) }}</button>
								<i v-if="meta.private" v-tooltip="i18n.ts._drawRoom.draftLayerHint" class="ti ti-lock" :class="$style.subLayerState" role="img" :aria-label="i18n.ts._drawRoom.draftLayerHint"></i>
								<span v-if="meta.blend != null" :class="$style.subLayerOpacity">{{ blendLabel(meta.blend) }}</span>
								<span v-if="meta.opacity < 1" :class="$style.subLayerOpacity">{{ Math.round(meta.opacity * 100) }}%</span>
								<button
									v-tooltip="meta.visible ? i18n.ts.hide : i18n.ts.show"
									class="_button"
									:class="$style.layerButton"
									:aria-label="meta.visible ? i18n.ts.hide : i18n.ts.show"
									:aria-pressed="meta.visible"
									@click="toggleMyLayerVisible(meta.id)"
								><i :class="meta.visible ? 'ti ti-eye' : 'ti ti-eye-off'"></i></button>
								<button v-tooltip="i18n.ts._drawRoom.layerMenu" class="_button" :class="$style.layerButton" :aria-label="i18n.ts._drawRoom.layerMenu" @click="openLayerMenu(meta, $event)"><i class="ti ti-dots"></i></button>
							</div>
						</template>
					</MkDraggable>
					<!-- JUICE: 描いているレイヤーの濃さ(動かしている間は自分の画面だけ変え、離したら送る) -->
					<label v-if="activeLayerMeta != null" :class="$style.layerOpacity">
						<i class="ti ti-droplet-half-2"></i>
						<span>{{ i18n.ts._drawRoom.layerOpacity }}</span>
						<input
							type="range"
							min="0"
							max="100"
							step="5"
							:value="Math.round(activeLayerMeta.opacity * 100)"
							:aria-label="`${i18n.ts._drawRoom.layerOpacity}: ${layerName($i.id, activeLayerMeta)}`"
							@input="previewActiveLayerOpacity(($event.target as HTMLInputElement).valueAsNumber)"
							@change="updateMyLayer(activeLayerMeta.id, { opacity: ($event.target as HTMLInputElement).valueAsNumber / 100 })"
						/>
						<span :class="$style.sizeValue">{{ Math.round(activeLayerMeta.opacity * 100) }}%</span>
					</label>
					<div :class="$style.layerActions">
						<button v-if="myLayers.length < MAX_USER_LAYERS" class="_button" :class="$style.addLayer" @click="addLayer()"><i class="ti ti-plus"></i> {{ i18n.ts._drawRoom.addLayer }}</button>
						<button v-if="myLayers.length < MAX_USER_LAYERS" v-tooltip="i18n.ts._drawRoom.draftLayerHint" class="_button" :class="$style.addLayer" @click="addLayer(true)"><i class="ti ti-lock"></i> {{ i18n.ts._drawRoom.addDraftLayer }}</button>
						<button class="_button" :class="[$style.addLayer, $style.deleteAllLayers]" @click="deleteAllMyLayers"><i class="ti ti-trash"></i> {{ i18n.ts._drawRoom.deleteAllMyLayers }}</button>
					</div>
				</div>
				<div v-else-if="layersOf(userId).length > 1" :class="$style.subLayers">
					<div
						v-for="meta in [...layersOf(userId)].reverse()"
						:key="meta.id"
						:class="[$style.subLayer, { [$style.subLayerHidden]: !meta.visible }]"
					>
						<span :class="$style.subLayerName">{{ layerName(userId, meta) }}</span>
						<span v-if="meta.blend != null" :class="$style.subLayerOpacity">{{ blendLabel(meta.blend) }}</span>
						<span v-if="meta.opacity < 1" :class="$style.subLayerOpacity">{{ Math.round(meta.opacity * 100) }}%</span>
						<i v-if="!meta.visible" v-tooltip="i18n.ts._drawRoom.layerHidden" class="ti ti-eye-off" :class="$style.subLayerState" role="img" :aria-label="i18n.ts._drawRoom.layerHidden"></i>
					</div>
				</div>
				</template>
				<MkSwitch v-model="myLayerOnTop" :class="$style.layerSwitch">
					<template #label>{{ i18n.ts._drawRoom.myLayerOnTop }}</template>
				</MkSwitch>
			</div>

			<!-- JUICE: レイヤーとチャットの間をドラッグして、高さの割合を変える(PCだけ) -->
			<div
				:class="$style.splitResizer"
				role="separator"
				aria-orientation="horizontal"
				tabindex="0"
				:aria-label="i18n.ts._drawRoom.resizeLayersChat"
				:aria-controls="`${layersPanelId} ${chatPanelId}`"
				:aria-valuenow="Math.round(layersRatio * 100)"
				:aria-valuemin="Math.round(LAYERS_RATIO_MIN * 100)"
				:aria-valuemax="Math.round(LAYERS_RATIO_MAX * 100)"
				@pointerdown="startSplitResize"
				@keydown.up.prevent="layersRatio = clampLayersRatio(layersRatio - 0.05)"
				@keydown.down.prevent="layersRatio = clampLayersRatio(layersRatio + 0.05)"
				@keydown.home.prevent="layersRatio = LAYERS_RATIO_MIN"
				@keydown.end.prevent="layersRatio = LAYERS_RATIO_MAX"
			></div>

			<!-- チャット -->
			<div :id="chatPanelId" class="_panel" :class="[$style.sidePanel, $style.chat, { [$style.sheetHidden]: mobilePanel !== 'chat' }]">
				<div :class="$style.sideHeader">
					<i class="ti ti-messages"></i> {{ i18n.ts._drawRoom.chat }}
					<button class="_button" :class="$style.sheetClose" :aria-label="i18n.ts.close" @click="mobilePanel = null"><i class="ti ti-x"></i></button>
				</div>
				<div ref="chatListEl" :class="$style.chatList">
					<div v-for="item in chatMessages" :key="item.message.id" :class="$style.chatItem">
						<MkAvatar :class="$style.chatAvatar" :user="item.user"/>
						<div :class="$style.chatBody">
							<div :class="$style.chatName">
								<MkUserName :user="item.user"/>
								<!-- JUICE: 発言した時刻(「◯分前」。マウスを乗せると日時) -->
								<MkTime :time="item.message.createdAt" :class="$style.chatTime"/>
							</div>
							<!-- JUICE: 絵文字(カスタム絵文字を含む)だけを表示に反映し、ほかの記法は書いたままの文字で出す -->
							<div :class="$style.chatText"><Mfm :text="item.message.text" :plain="true" :author="item.user" :nyaize="false"/></div>
						</div>
						<!-- JUICE: ほかの人の発言は通報できる -->
						<button
							v-if="item.user.id !== $i.id && !room.viewOnly"
							v-tooltip="i18n.ts.menu"
							class="_button"
							:class="$style.chatMenuButton"
							:aria-label="i18n.ts.menu"
							@click="openChatMenu($event, item)"
						><i class="ti ti-dots"></i></button>
					</div>
				</div>
				<form v-if="!room.isEnded && !room.viewOnly" :class="$style.chatForm" @submit.prevent="sendChat">
					<input ref="chatInputEl" v-model="chatText" :class="$style.chatInput" type="text" maxlength="500" :placeholder="i18n.ts._drawRoom.chatPlaceholder" :aria-label="i18n.ts._drawRoom.chatPlaceholder"/>
					<button v-tooltip="i18n.ts.emoji" class="_button" :class="$style.chatSend" type="button" :aria-label="i18n.ts.emoji" @click="insertChatEmoji"><i class="ti ti-mood-happy"></i></button>
					<button v-tooltip="i18n.ts.send" class="_button" :class="$style.chatSend" type="submit" :disabled="chatText.trim().length === 0" :aria-label="i18n.ts.send"><i class="ti ti-send"></i></button>
				</form>
			</div>
		</div>
	</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts">
// JUICE: 注意書き(CW)・センシティブ(NSFW)の部屋で「開く」を選んだ部屋(このタブを開いている間だけ覚える)
const acceptedRoomIds = new Set<string>();
</script>

<script lang="ts" setup>
import { computed, defineAsyncComponent, markRaw, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, shallowRef, useId, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { url } from '@@/js/config.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { uploadFile } from '@/utility/drive.js';
import { getCompressionSettings } from '@/composables/use-uploader.js';
import { prefer } from '@/preferences.js';
import { isWebpSupported } from '@/utility/isWebpSupported.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { ensureSignin, iAmModerator } from '@/i.js';
import { collapseHeaderActions } from '@/utility/collapse-header-actions.js';
import { floodFillMask, dilateMask, maskToFillPoints } from '@/utility/draw-fill.js';
import { DRAW_LAYER_BLENDS, DRAW_ROOM_CANVAS_MAX_SIZE, DRAW_ROOM_CANVAS_MIN_SIZE, DrawCanvasEngine, drawLayerKey, POINT_SCALE, encodeStroke, rotatePoints, THUMBNAIL_MAX_SIZE, brushSizeRange, clampCanvasSize, clampMaxMembers, decodePoints, decodeStroke, encodePoints } from '@/utility/draw-canvas.js';
import type { CanvasStroke, DrawLayerBlend, DrawStroke, DrawTool } from '@/utility/draw-canvas.js';
import { canRenderLayersInWorker, DrawRoomLayerRenderer } from '@/utility/draw-room-layer-renderer.js';
import { useInterval } from '@@/js/use-interval.js';

const props = defineProps<{
	roomId: string;
}>();

const $i = ensureSignin();
const router = useRouter();

// JUICE: よく使う色。これ以外はカラーピッカーで選ぶ
// JUICE: スマホ向けの表示。色・太さの欄と、下から出すパネル(レイヤー・チャット)の開閉
const brushPanelOpen = ref(false);
const mobilePanel = ref<'layers' | 'chat' | null>(null);
const chatUnread = ref(false);
// スマホ向けの表示になっているか(画面全体ではなく部屋の枠の幅で決める。CSSの @container と同じ基準)
const NARROW_MAX_WIDTH = 800;
const frameEl = useTemplateRef('frameEl');
const isNarrow = ref(false);
watch(frameEl, (el, _old, onCleanup) => {
	if (el == null) return;
	const observer = new ResizeObserver(() => {
		isNarrow.value = el.clientWidth <= NARROW_MAX_WIDTH;
	});
	observer.observe(el);
	onCleanup(() => observer.disconnect());
});

function toggleMobilePanel(panel: 'layers' | 'chat'): void {
	mobilePanel.value = mobilePanel.value === panel ? null : panel;
	brushPanelOpen.value = false;
	if (mobilePanel.value === 'chat') {
		chatUnread.value = false;
		scrollChatToBottom();
	}
}

const PALETTE = ['#000000', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#9e9e9e'];
// 描いている途中の線を送る間隔(ms)と、1回に送る点の最大数(サーバー側の上限に合わせる)
const STROKE_PART_INTERVAL_MS = 50;
const STROKE_PART_MAX_POINTS = 500;
// 1本の線の点の最大数(サーバー側の上限)。これを超えたら線を区切って続ける
const STROKE_MAX_POINTS = 5000;

const room = ref<Misskey.entities.DrawRoom | null>(null);
const error = ref<unknown>(null);
const canvasEl = useTemplateRef('canvasEl');
const overlayEl = useTemplateRef('overlayEl');
const overlayAlphaEl = useTemplateRef('overlayAlphaEl');
const viewportEl = useTemplateRef('viewportEl');
const chatListEl = useTemplateRef('chatListEl');
const chatInputEl = useTemplateRef('chatInputEl');
const minimapEl = useTemplateRef('minimapEl');
const engine = shallowRef<DrawCanvasEngine | null>(null);
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['drawRoom']> | null>(null);

// JUICE: スポイトは線を描かず、キャンバスの色を拾ってペンに戻る
const tool = ref<DrawTool | 'eyedropper' | 'select' | 'lasso' | 'move' | 'hand' | 'bucket'>('pen');
const color = ref('#000000');
// JUICE: 太さはペンと消しゴムで別々に覚えておき、スライダーは今の道具の太さを変える
const penSize = ref(6);
const eraserSize = ref(20);
const size = computed({
	get: () => (tool.value === 'eraser' ? eraserSize.value : penSize.value),
	set: (value: number) => {
		if (tool.value === 'eraser') eraserSize.value = value;
		else penSize.value = value;
	},
});
// JUICE: 太さ・筆の種類・線の中だけ塗るはペンと消しゴム、濃さはそれに加えて塗りのツールだけで使う
const usesBrushSize = computed(() => tool.value === 'pen' || tool.value === 'eraser');
const usesOpacity = computed(() => usesBrushSize.value || tool.value === 'bucket');
// 太さの上限。キャンバスの大きさに合わせて決める
const sizeMax = ref(60);
// JUICE: 太さを、覚えている値(またはキャンバスに合った値)で決めたか
let brushSizeInitialized = false;

// JUICE: 太さは、1%を1px・100%をそのキャンバスで一番太い筆とした割合で選ぶ。細い筆を細かく選べるよう、割合の2乗で太さにする
// (太さは小数のまま持ち、割合との行き来でつまみが戻らないようにする)
function sizeToPercent(value: number, max: number): number {
	const t = max > 1 ? Math.max(0, value - 1) / (max - 1) : 1;
	return Math.max(1, Math.min(100, Math.round(1 + Math.sqrt(t) * 99)));
}

function percentToSize(percent: number, max: number): number {
	const t = ((Math.max(1, Math.min(100, percent)) - 1) / 99) ** 2;
	return Math.round((1 + t * (max - 1)) * 100) / 100;
}

const sizePercent = computed({
	get: () => sizeToPercent(size.value, sizeMax.value),
	set: (percent: number) => {
		size.value = percentToSize(percent, sizeMax.value);
	},
});
// JUICE: 筆の種類(ペン・消しゴム共通)と、線の中だけ塗る(はみ出し防止)
// JUICE: areaは囲って塗る(ペンなら塗る、消しゴムなら消す)。線を描くのではなく、なぞって囲った範囲を扱う
const brushType = ref<'normal' | 'soft' | 'dot' | 'area'>('normal');
const clipToLines = ref(false);
// JUICE: 透明度ロック(レイヤーの描いてある所にだけ描く。ペン・塗りつぶし・囲って塗る)
const alphaLock = ref(false);
// JUICE: 筆圧で太さを変えるか・濃さを変えるか(プロファイルに覚える)
const pressureSize = prefer.model('drawRoomPressureSize');
const pressureOpacity = prefer.model('drawRoomPressureOpacity');
const pressureMode = computed<'size' | NonNullable<CanvasStroke['pressure']>>(() => {
	if (pressureSize.value && pressureOpacity.value) return 'both';
	if (pressureSize.value) return 'size';
	if (pressureOpacity.value) return 'opacity';
	return 'none';
});
// ドットをくっきり表示する(拡大したときに画素をぼかさない)。表示の好みはプロファイルに覚える(バックアップ・復元で戻る)
const dotView = prefer.model('drawRoomDotView');
// 画素の格子は、1画素が画面上で8px以上に拡大されたときだけ出す(それより小さいと格子で絵が灰色に見えてしまう)。
// 拡大するほど少しずつ濃くする(8倍でうっすら、24倍以上でいちばん濃く)
const PIXEL_GRID_MIN_SCALE = 8;
const showPixelGrid = computed(() => dotView.value && view.scale >= PIXEL_GRID_MIN_SCALE);
const pixelGridOpacity = computed(() => 0.06 + Math.min(1, (view.scale - PIXEL_GRID_MIN_SCALE) / 16) * 0.14);
// 格子の線(キャンバスの大きさが変わったときだけ作り直す)
const pixelGridPath = computed(() => {
	const r = room.value;
	if (r == null) return '';
	const parts: string[] = [];
	for (let x = 1; x < r.canvasWidth; x++) parts.push(`M${x} 0V${r.canvasHeight}`);
	for (let y = 1; y < r.canvasHeight; y++) parts.push(`M0 ${y}H${r.canvasWidth}`);
	return parts.join('');
});
// 線の不透明度(%)。ペンなら濃さ、消しゴムなら消す強さになる
// JUICE: 濃さは前に使った値から始める(プロファイルに覚える)
const opacity = ref(Math.max(5, Math.min(100, prefer.s.drawRoomOpacity)));
const myLayerOnTop = ref(true);

// JUICE: ペン・消しゴムの太さ(割合)と濃さを覚える。スライダーを動かしている間は何度も書き込まないよう、止まってから覚える
let saveBrushTimer: number | null = null;
watch([penSize, eraserSize, opacity], () => {
	if (saveBrushTimer != null) window.clearTimeout(saveBrushTimer);
	saveBrushTimer = window.setTimeout(() => {
		saveBrushTimer = null;
		const pen = sizeToPercent(penSize.value, sizeMax.value);
		const eraser = sizeToPercent(eraserSize.value, sizeMax.value);
		if (prefer.s.drawRoomPenSizePercent !== pen) prefer.commit('drawRoomPenSizePercent', pen);
		if (prefer.s.drawRoomEraserSizePercent !== eraser) prefer.commit('drawRoomEraserSizePercent', eraser);
		if (prefer.s.drawRoomOpacity !== opacity.value) prefer.commit('drawRoomOpacity', opacity.value);
	}, 500);
});
const hiddenLayers = ref(new Set<string>());

// JUICE: 1人が複数のレイヤーを持てる。ユーザーごとのレイヤーの一覧(重なり順は下から)。
// レイヤーの表示・濃さ・重なり順は描いた人が決め、ほかの人の画面にも反映される
type LayerMeta = Misskey.entities.DrawLayer;
const DEFAULT_LAYERS: LayerMeta[] = [{ id: '0', name: '', visible: true, opacity: 1 }];
const MAX_USER_LAYERS = 8;
const userLayers = reactive(new Map<string, LayerMeta[]>());
const myLayers = computed(() => userLayers.get($i.id) ?? DEFAULT_LAYERS);
// 自分が今描いているレイヤー
const activeLayerId = ref('0');
const activeKey = computed(() => drawLayerKey($i.id, activeLayerId.value));

function layersOf(userId: string): LayerMeta[] {
	return userLayers.get(userId) ?? DEFAULT_LAYERS;
}

// その人のそのレイヤーのキー(一覧に無いレイヤー(消された直後など)なら、その人の一番下のレイヤー)
function keyFor(userId: string, layerId: string | undefined): string {
	const metas = layersOf(userId);
	const id = layerId ?? '0';
	// ほかの人のレイヤーが全て下描き(こちらには届かない)なら一覧は空になる
	return drawLayerKey(userId, metas.length === 0 || metas.some(meta => meta.id === id) ? id : metas[0].id);
}

function applyUserLayers(userId: string, layers: LayerMeta[]): void {
	userLayers.set(userId, layers);
	engine.value?.setUserLayers(userId, layers);
	// 描いていたレイヤーが消されたら、一番上のレイヤーに移る
	if (userId === $i.id && !layers.some(layer => layer.id === activeLayerId.value)) activeLayerId.value = layers.at(-1)!.id;
}

// その人の全てのレイヤーに同じ操作をする(ほかの人の操作の反映など、どのレイヤーの線か分からないとき)
function forKeys(userId: string, fn: (key: string) => void): void {
	for (const key of engine.value?.keysOf(userId) ?? []) fn(key);
}

watch(activeKey, (key) => {
	clearStrokeSelection();
	engine.value?.setActiveKey(key);
});

// 名前の無いレイヤー(最初のレイヤーなど)は「レイヤーN」と表示する
function layerName(userId: string, meta: LayerMeta): string {
	if (meta.name !== '') return meta.name;
	return i18n.tsx._drawRoom.layerN({ n: layersOf(userId).findIndex(layer => layer.id === meta.id) + 1 });
}

// 自分のレイヤーの一覧を変えて送る(自分の画面にはすぐ反映する)
function sendMyLayers(layers: LayerMeta[]): void {
	applyUserLayers($i.id, layers);
	connection.value?.send('setLayers', { layers });
	if (!layerUserIds.value.includes($i.id)) refreshLayerList();
}

function newLayerId(): string {
	const ids = new Set(myLayers.value.map(layer => layer.id));
	let id: string;
	do id = Math.random().toString(36).slice(2, 10); while (ids.has(id));
	return id;
}

// 名前の無いレイヤー(最初のレイヤーなど)は並びの番号で表示するので、足す・並べ替える前に、
// 今表示している名前を付けておく(並べ替えた後に、番号がずれてほかのレイヤーと同じ名前にならないように)
function withFixedNames(layers: LayerMeta[]): LayerMeta[] {
	return layers.map(layer => (layer.name !== '' ? layer : { ...layer, name: layerName($i.id, layer) }));
}

// JUICE: 一覧は上にあるものから並べる(重なり順とは逆)
const myLayersTopFirst = computed(() => [...myLayers.value].reverse());

// つまみをドラッグして並べ替えた(上にあるものからの並び)
function reorderMyLayers(topFirst: LayerMeta[]): void {
	const named = new Map(withFixedNames(myLayers.value).map(layer => [layer.id, layer]));
	sendMyLayers([...topFirst].reverse().map(layer => named.get(layer.id) ?? layer));
}

// 描いているレイヤーのすぐ上に、新しいレイヤーを足して、そこに描くようにする。
// JUICE: draftなら下描き(自分の画面にだけ見え、ほかの人には送らない・保存する画像にも入らない)にする
function addLayer(draft = false): void {
	const layers = withFixedNames(myLayers.value);
	if (layers.length >= MAX_USER_LAYERS) return;
	const names = new Set(layers.map(layer => layerName($i.id, layer)));
	const nameOf = (n: number) => (draft ? i18n.tsx._drawRoom.draftLayerN({ n }) : i18n.tsx._drawRoom.layerN({ n }));
	let n = draft ? 1 : layers.length + 1;
	while (names.has(nameOf(n))) n++;
	const id = newLayerId();
	const index = layers.findIndex(layer => layer.id === activeLayerId.value) + 1;
	// 名前を空にすると並びの番号で表示され、並べ替えるたびに番号が変わってしまうので、足したときの番号を名前として付ける
	// (足した人の言語の名前になるが、名前はあとから変えられる)
	layers.splice(index, 0, { id, name: nameOf(n), visible: true, opacity: 1, ...(draft ? { private: true } : {}) });
	sendMyLayers(layers);
	activeLayerId.value = id;
}

function updateMyLayer(id: string, patch: Partial<LayerMeta>): void {
	sendMyLayers(myLayers.value.map(layer => (layer.id === id ? { ...layer, ...patch } : layer)));
}

// JUICE: 合成モードの名前
function blendLabel(value: DrawLayerBlend | undefined): string {
	const labels: Record<DrawLayerBlend | 'normal', string> = {
		normal: i18n.ts._drawRoom.blendNormal,
		multiply: i18n.ts._drawRoom.blendMultiply,
		screen: i18n.ts._drawRoom.blendScreen,
		overlay: i18n.ts._drawRoom.blendOverlay,
		darken: i18n.ts._drawRoom.blendDarken,
		lighten: i18n.ts._drawRoom.blendLighten,
		'color-dodge': i18n.ts._drawRoom.blendColorDodge,
		'color-burn': i18n.ts._drawRoom.blendColorBurn,
		'hard-light': i18n.ts._drawRoom.blendHardLight,
		'soft-light': i18n.ts._drawRoom.blendSoftLight,
		difference: i18n.ts._drawRoom.blendDifference,
		exclusion: i18n.ts._drawRoom.blendExclusion,
		hue: i18n.ts._drawRoom.blendHue,
		saturation: i18n.ts._drawRoom.blendSaturation,
		color: i18n.ts._drawRoom.blendColor,
		luminosity: i18n.ts._drawRoom.blendLuminosity,
		lighter: i18n.ts._drawRoom.blendLighter,
	};
	return labels[value ?? 'normal'];
}

// JUICE: 描いているレイヤー(濃さのスライダー用)
const activeLayerMeta = computed(() => myLayers.value.find(layer => layer.id === activeLayerId.value) ?? null);

// 濃さのスライダーを動かしている間は、自分の画面にだけ反映する(離したときに送る)
function previewActiveLayerOpacity(percent: number): void {
	const meta = activeLayerMeta.value;
	if (meta == null || !Number.isFinite(percent)) return;
	applyUserLayers($i.id, myLayers.value.map(layer => (layer.id === meta.id ? { ...layer, opacity: percent / 100 } : layer)));
}

function toggleMyLayerVisible(id: string): void {
	const layer = myLayers.value.find(l => l.id === id);
	if (layer != null) updateMyLayer(id, { visible: !layer.visible });
}

// 重なり順を1つ上(+1)・下(-1)へ
function moveMyLayer(id: string, direction: 1 | -1): void {
	const layers = withFixedNames(myLayers.value);
	const i = layers.findIndex(layer => layer.id === id);
	const j = i + direction;
	if (i === -1 || j < 0 || j >= layers.length) return;
	[layers[i], layers[j]] = [layers[j], layers[i]];
	sendMyLayers(layers);
}

async function renameMyLayer(meta: LayerMeta): Promise<void> {
	const { canceled, result } = await os.inputText({ title: i18n.ts._drawRoom.renameLayer, default: layerName($i.id, meta), maxLength: 32 });
	if (canceled || result == null) return;
	updateMyLayer(meta.id, { name: result.trim() });
}

async function deleteMyLayer(meta: LayerMeta): Promise<void> {
	if (myLayers.value.length <= 1) return;
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx._drawRoom.deleteLayerConfirm({ name: layerName($i.id, meta) }) });
	if (canceled) return;
	sendMyLayers(myLayers.value.filter(layer => layer.id !== meta.id));
}

// JUICE: 下描きにする(ほかの人の画面からは、そのレイヤーが消える)/みんなに見せる(今の線がほかの人にも届く)
async function setMyLayerPrivate(meta: LayerMeta, value: boolean): Promise<void> {
	if (!value) {
		const { canceled } = await os.confirm({ type: 'question', text: i18n.tsx._drawRoom.publishLayerConfirm({ name: layerName($i.id, meta) }) });
		if (canceled) return;
	}
	// 名前の無いレイヤーは番号で表示するので、ほかの人の一覧から下描きが消えて番号がずれないよう、今の名前を付けておく
	const layers = withFixedNames(myLayers.value).map(layer => (layer.id === meta.id ? { ...layer, private: value } : layer));
	sendMyLayers(layers.map(({ private: isPrivate, ...rest }) => (isPrivate ? { ...rest, private: true } : rest)));
}

// JUICE: 自分のレイヤーと線を全て消し、空のレイヤー1枚だけにする(前と違うidにして、サーバーで全ての線を消させる)
async function deleteAllMyLayers(): Promise<void> {
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts._drawRoom.deleteAllMyLayersConfirm });
	if (canceled) return;
	const id = newLayerId();
	sendMyLayers([{ id, name: '', visible: true, opacity: 1 }]);
	activeLayerId.value = id;
}

function openLayerMenu(meta: LayerMeta, ev: MouseEvent): void {
	const index = myLayers.value.findIndex(layer => layer.id === meta.id);
	os.popupMenu([{
		text: i18n.ts._drawRoom.renameLayer,
		icon: 'ti ti-pencil',
		action: () => renameMyLayer(meta),
	}, {
		// JUICE: 合成モード(乗算・焼き込みカラーなど)
		type: 'parent',
		text: `${i18n.ts._drawRoom.blendMode}: ${blendLabel(meta.blend)}`,
		icon: 'ti ti-blend-mode',
		children: [undefined, ...DRAW_LAYER_BLENDS].map(value => ({
			text: blendLabel(value),
			icon: (meta.blend ?? undefined) === value ? 'ti ti-check' : undefined,
			active: (meta.blend ?? undefined) === value,
			action: () => updateMyLayer(meta.id, { blend: value }),
		})),
	}, {
		// JUICE: 下描き(自分だけ) ⇔ みんなに見せる
		text: meta.private ? i18n.ts._drawRoom.publishLayer : i18n.ts._drawRoom.makeLayerDraft,
		icon: meta.private ? 'ti ti-world' : 'ti ti-lock',
		action: () => setMyLayerPrivate(meta, !meta.private),
	}, { type: 'divider' }, ...(index < myLayers.value.length - 1 ? [{
		text: i18n.ts._drawRoom.moveLayerUp,
		icon: 'ti ti-arrow-up',
		action: () => moveMyLayer(meta.id, 1),
	}] : []), ...(index > 0 ? [{
		text: i18n.ts._drawRoom.moveLayerDown,
		icon: 'ti ti-arrow-down',
		action: () => moveMyLayer(meta.id, -1),
	}] : []), ...(myLayers.value.length > 1 ? [{ type: 'divider' as const }, {
		text: i18n.ts._drawRoom.deleteLayer,
		icon: 'ti ti-trash',
		danger: true,
		action: () => deleteMyLayer(meta),
	}] : [])], (ev.currentTarget ?? ev.target) as HTMLElement);
}

// レイヤー一覧の表示順(描いたことのある人+今のメンバー)
const layerUserIds = ref<string[]>([]);
// JUICE: 部屋を開いたときの線の読み込みの進み具合(読み込み中でなければnull)
const canvasLoading = ref<{ done: number; total: number } | null>(null);
// JUICE: 今この部屋を開いている人(オンライン)。レイヤー一覧には、描いていない見学中の人もオンラインの間は出す
const onlineUserIds = ref(new Set<string>());
// JUICE: 終了後は、線が残っている人のレイヤーだけを出す(見学していた人・描いていない参加者は出さない)
const listedUserIds = computed(() => room.value?.isEnded ? layerUserIds.value : [
	...layerUserIds.value,
	...[...onlineUserIds.value].filter(id => !layerUserIds.value.includes(id)),
]);
const userMap = reactive(new Map<string, Misskey.entities.UserLite>());
const chatMessages = ref<{ message: Misskey.entities.DrawRoomChatMessage; user: Misskey.entities.UserLite }[]>([]);
const chatText = ref('');
// JUICE: 表示の位置・拡大率・回転(ラジアン)。キャンバスの点(cx, cy)は、表示領域の上では
// (x, y) + 回転(rotation)・拡大(scale)した(cx, cy) の位置に見える
const view = reactive({ x: 0, y: 0, scale: 1, rotation: 0 });

// キャンバス座標 → 表示領域の座標
function canvasToView(cx: number, cy: number): [number, number] {
	const cos = Math.cos(view.rotation);
	const sin = Math.sin(view.rotation);
	const sx = cx * view.scale;
	const sy = cy * view.scale;
	return [view.x + sx * cos - sy * sin, view.y + sx * sin + sy * cos];
}

// 表示領域の座標 → キャンバス座標
function viewToCanvas(vx: number, vy: number): [number, number] {
	const cos = Math.cos(view.rotation);
	const sin = Math.sin(view.rotation);
	const dx = vx - view.x;
	const dy = vy - view.y;
	return [(dx * cos + dy * sin) / view.scale, (-dx * sin + dy * cos) / view.scale];
}

// 表示領域の大きさ(全体マップの枠の計算用)
const viewportSize = reactive({ width: 0, height: 0 });
// JUICE: ほかの人のカーソル(キャンバス座標)。しばらく動きが無ければ消す
const cursors = reactive(new Map<string, { x: number; y: number; updatedAt: number; pet: boolean }>());

// JUICE: なでるツール。オンの間は、ドラッグしても描かず・表示も動かさず、なでている位置を送る
const petting = ref(false);
// なでられるのは開催中の部屋だけ(終了した部屋・確認のために開いている部屋では、ボタンも出さない)
const canPet = computed(() => room.value != null && !room.value.isEnded && !room.value.viewOnly);
watch(canPet, (value) => {
	if (!value) petting.value = false;
});
// ほかの人の「なでている」は、続きが届かなければしばらくして普通のカーソルに戻す
// (なで終わりの知らせが回数制限で届かなかったときに、手が出たままにならないように)
const PET_STALE_MS = 800;
const petStaleTimers = new Map<string, number>();
let petPointerId: number | null = null;
// なでたところに出るハート(キャンバス座標)。しばらくしたら消す
const petHearts = ref<{ id: number; x: number; y: number; drift: number }[]>([]);
let petHeartSeq = 0;
const lastPetHeartAt = new Map<string, number>();
const PET_HEART_INTERVAL_MS = 180;
const PET_HEART_LIFETIME_MS = 1200;
const PET_HEART_MAX = 60;

function spawnPetHeart(userId: string, x: number, y: number): void {
	const now = Date.now();
	if (now - (lastPetHeartAt.get(userId) ?? 0) < PET_HEART_INTERVAL_MS) return;
	lastPetHeartAt.set(userId, now);
	const id = ++petHeartSeq;
	petHearts.value = [...petHearts.value.slice(-(PET_HEART_MAX - 1)), { id, x, y, drift: Math.round((Math.random() - 0.5) * 24) }];
	window.setTimeout(() => {
		petHearts.value = petHearts.value.filter(heart => heart.id !== id);
	}, PET_HEART_LIFETIME_MS);
}

const CURSOR_TIMEOUT_MS = 8000;
// 自分のカーソルを送る間隔(ms)
const CURSOR_SEND_INTERVAL_MS = 60;

const isOwner = computed(() => room.value?.ownerId === $i.id);

// JUICE: 注意書き(CW)・センシティブ(NSFW)の部屋は、開くと決めるまで絵を隠す(部屋主と、センシティブを隠さない設定の人は、
// 注意書きが無ければそのまま)。開くと決めた部屋は、このタブを開いている間は聞き直さない
const contentAccepted = ref(acceptedRoomIds.has(props.roomId));
watch(() => props.roomId, (roomId) => {
	contentAccepted.value = acceptedRoomIds.has(roomId);
});
const contentGated = computed(() => {
	const r = room.value;
	if (r == null || isOwner.value || contentAccepted.value) return false;
	return r.cw != null || (r.isSensitive && prefer.s.nsfw !== 'ignore');
});

function acceptContent(): void {
	acceptedRoomIds.add(props.roomId);
	contentAccepted.value = true;
}

// 観戦に回った部屋主は、満員でも描く人に戻れる
const isFull = computed(() => room.value != null && room.value.members.length >= room.value.maxMembers && !isOwner.value);
const canDraw = computed(() => room.value != null && !room.value.isEnded && room.value.isMember);

function rememberUsers(users: Misskey.entities.UserLite[]): void {
	for (const user of users) userMap.set(user.id, user);
}

function refreshLayerList(): void {
	if (engine.value == null || room.value == null) return;
	const e = engine.value;
	if (room.value.isEnded) {
		// 終了後は、線が残っている人だけ(開催中に全部消した人・描かなかった参加者は出さない)
		layerUserIds.value = e.ownerIds.filter(id => e.hasStrokesOf(id));
		ensureUsers(layerUserIds.value);
		return;
	}
	const ids = new Set(e.ownerIds);
	for (const member of room.value.members) ids.add(member.id);
	layerUserIds.value = [...ids];
	ensureUsers(layerUserIds.value);
}

// アイコン・名前をまだ知らないユーザーの情報を取得する
const fetchingUserIds = new Set<string>();

function ensureUsers(userIds: string[]): void {
	const unknown = userIds.filter(id => !userMap.has(id) && !fetchingUserIds.has(id));
	if (unknown.length === 0) return;
	for (const id of unknown) fetchingUserIds.add(id);
	misskeyApi('users/show', { userIds: unknown }).then(users => rememberUsers(users)).finally(() => {
		for (const id of unknown) fetchingUserIds.delete(id);
	});
}

//#region 初期化・ストリーム
// JUICE: 部屋の読み込みは非同期で、読み込み中に別の部屋へ移ったり画面を離れたりすることがある。
// 古い読み込みの続きが新しい状態を上書きしないよう、世代番号が変わっていたら途中でやめる
let initGeneration = 0;
// 線の一覧を取得している間に届いた出来事は、取得した一覧で上書きされないよう、読み込み後に適用し直す
let bufferedEvents: (() => void)[] | null = null;
let wasDisconnected = false;

function applyEvent(fn: () => void): void {
	if (bufferedEvents != null) bufferedEvents.push(fn);
	else fn();
}

async function init(): Promise<void> {
	const generation = ++initGeneration;
	error.value = null;
	cancelStroke();
	disposeRoom();
	hiddenLayers.value = new Set();
	userLayers.clear();
	activeLayerId.value = '0';
	layerUserIds.value = [];
	chatMessages.value = [];
	try {
		const r = await misskeyApi('draw-rooms/show', { roomId: props.roomId });
		if (generation !== initGeneration) return;
		room.value = r;
		rememberUsers([r.owner, ...r.members]);

		const e = markRaw(new DrawCanvasEngine(r.canvasWidth, r.canvasHeight));
		const brush = brushSizeRange(r.canvasWidth, r.canvasHeight);
		// 最初に開いたときと、別の大きさの部屋から移ってきたときは、太さを決め直す
		if (!brushSizeInitialized || brush.max !== sizeMax.value) {
			brushSizeInitialized = true;
			sizeMax.value = brush.max;
			// JUICE: 前に使った太さ(割合)があればそこから、無ければその部屋に合った太さから始める
			const savedPen = prefer.s.drawRoomPenSizePercent;
			const savedEraser = prefer.s.drawRoomEraserSizePercent;
			penSize.value = savedPen != null ? percentToSize(savedPen, brush.max) : brush.initial;
			// 消しゴムは少し太めから始める
			eraserSize.value = savedEraser != null ? percentToSize(savedEraser, brush.max) : Math.min(brush.max, brush.initial * 3);
		}
		e.myUserId = $i.id;
		e.activeKey = activeKey.value;
		e.myLayerOnTop = myLayerOnTop.value;
		engine.value = e;
		await nextTick();
		if (generation !== initGeneration) return;
		if (canvasEl.value && overlayEl.value && overlayAlphaEl.value) e.attach(canvasEl.value, overlayEl.value, overlayAlphaEl.value);
		e.onThumbnailChange = updateMinimap;
		fitToScreen();

		canvasLoading.value = { done: 0, total: 0 };
		await syncState(generation);
	} catch (err) {
		if (generation === initGeneration) error.value = err;
	} finally {
		if (generation === initGeneration) canvasLoading.value = null;
	}
}

// 読み込みで、画面を更新せずに続けて線を描く長さ(ミリ秒)
const LOAD_SLICE_MS = 30;

// 描画の合間に、画面を一度描き直させる(読み込み中の表示を出す・更新するため)
function nextFrame(): Promise<void> {
	return new Promise(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
}

/**
 * 線とチャットをサーバーから取り直す(初回と、ストリームの再接続時)。
 * 取りこぼさないよう先にストリームへつなぎ、取得中に届いた出来事は取得後に適用し直す
 */
async function syncState(generation: number): Promise<void> {
	const r = room.value;
	const e = engine.value;
	if (r == null || e == null) return;
	bufferedEvents = [];
	if (!r.isEnded && connection.value == null) connect();
	try {
		const [layers, chat] = await Promise.all([
			misskeyApi('draw-rooms/strokes', { roomId: r.id }),
			misskeyApi('draw-rooms/chat-history', { roomId: r.id }),
		]);
		if (generation !== initGeneration) return;
		chatMessages.value = chat;
		rememberUsers(chat.map(item => item.user));
		// JUICE: 線が多いと描くのに時間がかかる。使えれば複数のWorkerで同時にレイヤーを描いて画像で受け取り、
		// 使えなければ少しずつ(1回あたりLOAD_SLICE_MSまで)描いて合間に画面を更新する(固まって見えないように)
		const jobs: { key: string; encoded: DrawStroke[] }[] = [];
		for (const layer of layers) {
			// レイヤーの一覧を反映してから、線をそれぞれのレイヤーに入れる(線の無いレイヤーも空にし直す)
			applyUserLayers(layer.userId, layer.layers);
			const byKey = new Map<string, DrawStroke[]>(layer.layers.map(meta => [drawLayerKey(layer.userId, meta.id), []]));
			for (const stroke of layer.strokes) byKey.get(keyFor(layer.userId, stroke.layer))?.push(stroke);
			for (const [key, encoded] of byKey) jobs.push({ key, encoded });
		}
		for (const job of jobs) e.beginLoadLayer(job.key);
		if (canvasLoading.value != null) canvasLoading.value = { done: 0, total: jobs.length };
		const progress = () => {
			if (canvasLoading.value != null) canvasLoading.value = { done: canvasLoading.value.done + 1, total: jobs.length };
		};
		let deadline = performance.now() + LOAD_SLICE_MS;
		const yieldIfNeeded = async () => {
			if (performance.now() < deadline) return true;
			await nextFrame();
			deadline = performance.now() + LOAD_SLICE_MS;
			return generation === initGeneration;
		};
		// 画面を固めないよう、線を描画用の形にするのも少しずつ
		const decodeAll = async (encoded: DrawStroke[]) => {
			const strokes: CanvasStroke[] = [];
			for (const stroke of encoded) {
				strokes.push(decodeStroke(stroke));
				if (!await yieldIfNeeded()) return null;
			}
			return strokes;
		};
		const drawOnMainThread = async (key: string, strokes: CanvasStroke[]) => {
			e.beginLoadLayer(key);
			let i = 0;
			while (i < strokes.length) {
				i += e.loadStrokes(key, strokes, i, deadline);
				if (!await yieldIfNeeded()) return false;
			}
			return true;
		};
		const renderer = canRenderLayersInWorker() ? new DrawRoomLayerRenderer() : null;
		try {
			// 線の多いレイヤーから先に頼む(Workerの待ち時間を減らす)。受け取る順も同じにし、同時に頼むのは
			// Workerの数+1までにする(描き終えた大きな画像を、受け取るまで溜め込まないように)
			for (const job of jobs) if (job.encoded.length === 0) progress();
			const ordered = jobs.filter(job => job.encoded.length > 0).sort((a, b) => b.encoded.length - a.encoded.length);
			const inflight: Promise<ImageBitmap | null>[] = [];
			let requested = 0;
			const requestNext = () => {
				if (renderer == null || requested >= ordered.length) return;
				inflight.push(renderer.render(r.canvasWidth, r.canvasHeight, ordered[requested++].encoded));
			};
			for (let i = 0; i < (renderer?.concurrency ?? 0) + 1; i++) requestNext();
			try {
				for (const job of ordered) {
					const strokes = await decodeAll(job.encoded);
					if (strokes == null) return;
					const image = renderer != null ? await inflight.shift()! : null;
					requestNext();
					if (generation !== initGeneration) {
						image?.close();
						return;
					}
					if (image != null) e.loadLayerImage(job.key, strokes, image);
					else if (!await drawOnMainThread(job.key, strokes)) return;
					progress();
				}
			} finally {
				// 途中でやめたときに、受け取らなかった画像を閉じる
				for (const pending of inflight) void pending.then(image => image?.close());
			}
		} finally {
			renderer?.dispose();
		}
		e.finishLoad(jobs.map(job => job.key));
	} finally {
		const events = bufferedEvents ?? [];
		bufferedEvents = null;
		if (generation === initGeneration) {
			for (const fn of events) fn();
		}
	}
	refreshLayerList();
	scrollChatToBottom();
}

function connect(): void {
	const c = markRaw(useStream().useChannel('drawRoom', { roomId: props.roomId }));
	connection.value = c;
	c.on('strokePart', payload => applyEvent(() => {
		// 自分の線はローカルで描いているので、自分宛てに戻ってきた分は無視する
		if (payload.userId === $i.id) return;
		engine.value?.addStrokePart(keyFor(payload.userId, payload.layer), {
			id: payload.strokeId,
			tool: payload.tool,
			color: payload.color,
			size: payload.size,
			opacity: payload.opacity,
			brush: payload.brush,
			layer: payload.layer,
			...(payload.lock === true ? { lock: true } : {}),
			...(payload.pressure != null ? { pressure: payload.pressure } : {}),
			...(payload.clip != null ? { clip: decodePoints(payload.clip) } : {}),
			points: decodePoints(payload.points),
		});
		if (!layerUserIds.value.includes(payload.userId)) refreshLayerList();
	}));
	// JUICE: カーソルはサーバーが一定間隔で全員分をまとめて送ってくる
	c.on('cursors', payload => {
		const now = Date.now();
		for (const cursor of payload.cursors) {
			if (cursor.userId === $i.id) continue;
			if (cursor.x == null || cursor.y == null) {
				cursors.delete(cursor.userId);
				continue;
			}
			cursors.set(cursor.userId, { x: cursor.x, y: cursor.y, updatedAt: now, pet: cursor.pet === true });
			if (cursor.pet === true) {
				spawnPetHeart(cursor.userId, cursor.x, cursor.y);
				const userId = cursor.userId;
				window.clearTimeout(petStaleTimers.get(userId));
				petStaleTimers.set(userId, window.setTimeout(() => {
					petStaleTimers.delete(userId);
					const c = cursors.get(userId);
					if (c != null && c.pet) cursors.set(userId, { ...c, pet: false });
				}, PET_STALE_MS));
			}
		}
		ensureUsers([...cursors.keys()]);
	});
	c.on('strokeCancel', payload => applyEvent(() => {
		// 自分の線が取りやめになった=サーバーが受け付けなかったので、ローカルで確定させた分も消す
		if (payload.userId === $i.id) forKeys($i.id, key => engine.value?.removeStroke(key, payload.strokeId));
		else forKeys(payload.userId, key => engine.value?.removePending(key, payload.strokeId));
	}));
	c.on('stroke', payload => applyEvent(() => {
		engine.value?.addStroke(keyFor(payload.userId, payload.stroke.layer), decodeStroke(payload.stroke));
		if (!layerUserIds.value.includes(payload.userId)) refreshLayerList();
	}));
	// JUICE: 取り消し・やり直し(自分の分も、サーバーから届いてから反映する)
	c.on('strokesPatched', payload => applyEvent(() => {
		const e = engine.value;
		if (e == null) return;
		for (const step of payload.steps) {
			if (step.t === 'del') {
				const ids = new Set(step.ids);
				forKeys(payload.userId, key => e.deleteStrokes(key, ids));
			} else if (step.t === 'mv') {
				const ids = step.ids == null ? null : new Set(step.ids);
				forKeys(payload.userId, key => e.moveStrokes(key, ids, step.dx, step.dy));
			} else {
				// 線のレイヤーごとに分けて戻す(知らないレイヤー=ほかの人の下描きの線は届かない)
				const byKey = new Map<string, { before: string | null; stroke: CanvasStroke }[]>();
				for (const item of step.items) {
					const key = keyFor(payload.userId, item.stroke.layer);
					const list = byKey.get(key) ?? [];
					list.push({ before: item.before, stroke: decodeStroke(item.stroke) });
					byKey.set(key, list);
				}
				for (const [key, items] of byKey) e.insertStrokes(key, items);
			}
		}
		if (payload.userId === $i.id) pruneStrokeSelection();
		if (!layerUserIds.value.includes(payload.userId)) refreshLayerList();
	}));
	c.on('clearLayer', payload => applyEvent(() => {
		// レイヤーを指定していればそのレイヤーだけ、無ければその人の全てのレイヤー
		// 知らないレイヤー(ほかの人の下描きなど)なら何もしない(ほかのレイヤーを消してしまわないように)
		if (payload.layer == null) {
			forKeys(payload.userId, key => engine.value?.clearLayer(key));
		} else if (layersOf(payload.userId).some(meta => meta.id === payload.layer)) {
			engine.value?.clearLayer(keyFor(payload.userId, payload.layer));
		}
		if (payload.userId === $i.id) pruneStrokeSelection();
	}));
	// JUICE: その人のレイヤーの一覧が変わった(自分の変更は送る前に反映しているが、同じ内容なのでそのまま反映する)
	c.on('layersUpdated', payload => applyEvent(() => {
		applyUserLayers(payload.userId, payload.layers);
		if (payload.userId === $i.id) pruneStrokeSelection();
		refreshLayerList();
	}));
	// JUICE: 移動ツール・選んだ線の削除。自分の操作は送る前に自分の画面に反映しているので、戻ってきた分は無視する
	c.on('strokesMoved', payload => applyEvent(() => {
		if (payload.userId === $i.id) return;
		const ids = payload.strokeIds == null ? null : new Set(payload.strokeIds);
		forKeys(payload.userId, key => engine.value?.moveStrokes(key, ids, payload.dx, payload.dy));
	}));
	// JUICE: 線の本数・データ量の上限に達して、描いた線が受け付けられなかった
	c.on('strokeLimitReached', payload => {
		// 描き続けても何度も出さないよう、少し間を空ける
		if (Date.now() - lastLimitToastAt < 5000) return;
		lastLimitToastAt = Date.now();
		os.toast(payload.kind === 'strokes'
			? i18n.tsx._drawRoom.strokeLimitReached({ n: payload.limit })
			: payload.kind === 'bytes'
				? i18n.tsx._drawRoom.strokeBytesLimitReached({ n: payload.limit })
				: i18n.tsx._drawRoom.roomBytesLimitReached({ n: payload.limit }));
	});
	// JUICE: 自分の線の移動・削除・置き換えがサーバーで断られた(レイヤーの上限を超えた等)。
	// 自分の画面では先に反映しているので、線を取り直してサーバーの状態に戻す
	c.on('operationRejected', () => {
		clearStrokeSelection();
		os.toast(i18n.ts._drawRoom.operationRejected);
		syncState(initGeneration).catch(() => {});
	});
	c.on('strokesSplit', payload => applyEvent(() => {
		if (payload.userId === $i.id) return;
		const splits = payload.splits.map(split => ({ id: split.id, pieces: split.pieces.map(decodeStroke) }));
		forKeys(payload.userId, key => engine.value?.replaceStrokes(key, splits));
	}));
	// JUICE: ほかの人が下描きのレイヤーを皆に見せるようにした(そのレイヤーの今の線を入れる)
	c.on('layerPublished', payload => applyEvent(() => {
		const e = engine.value;
		if (payload.userId === $i.id || e == null) return;
		const key = keyFor(payload.userId, payload.layer);
		e.beginLoadLayer(key);
		e.loadStrokes(key, payload.strokes.map(decodeStroke), 0, Infinity);
		e.finishLoad([key]);
	}));
	c.on('strokesDeleted', payload => applyEvent(() => {
		if (payload.userId === $i.id) return;
		const ids = new Set(payload.strokeIds);
		forKeys(payload.userId, key => engine.value?.deleteStrokes(key, ids));
	}));
	c.on('chat', payload => applyEvent(() => {
		if (chatMessages.value.some(item => item.message.id === payload.message.id)) return;
		rememberUsers([payload.user]);
		chatMessages.value = [...chatMessages.value, payload].slice(-100);
		scrollChatToBottom();
		// スマホでチャットを閉じているときは、ボタンに未読の印を付ける
		if (isNarrow.value && mobilePanel.value !== 'chat' && payload.user.id !== $i.id) chatUnread.value = true;
	}));
	c.on('memberJoined', payload => {
		if (room.value == null) return;
		rememberUsers([payload.user]);
		if (!room.value.members.some(m => m.id === payload.user.id)) {
			room.value = {
				...room.value,
				members: [...room.value.members, payload.user],
				isMember: room.value.isMember || payload.user.id === $i.id,
			};
		}
		refreshLayerList();
	});
	c.on('presence', payload => {
		// 裏のタブで開いた場合など、画面を見ていないのにオンラインになっていたら知らせる
		// (つないだ直後はサーバーの準備ができていないことがあるので、一覧が届いてから送る)
		if (payload.userIds.includes($i.id) && window.document.visibilityState !== 'visible') sendVisibility();
		onlineUserIds.value = new Set(payload.userIds);
		ensureUsers(payload.userIds);
	});
	c.on('memberLeft', payload => {
		if (room.value == null) return;
		room.value = {
			...room.value,
			members: room.value.members.filter(m => m.id !== payload.userId),
			isMember: payload.userId === $i.id ? false : room.value.isMember,
		};
		// 描きかけのまま抜けた人の途中の線は、続きも確定も来ないので消す
		forKeys(payload.userId, key => engine.value?.clearPending(key));
		cursors.delete(payload.userId);
		if (payload.userId === $i.id) {
			cancelStroke();
			if (payload.kicked) os.toast(i18n.ts._drawRoom.kicked);
		}
		refreshLayerList();
	});
	c.on('updated', payload => {
		if (room.value == null) return;
		const resized = payload.room.canvasWidth !== room.value.canvasWidth || payload.room.canvasHeight !== room.value.canvasHeight;
		room.value = { ...payload.room, isMember: room.value.isMember, viewOnly: room.value.viewOnly };
		// JUICE: 部屋主がキャンバスの大きさを変えたら、新しい大きさで読み込み直す(描きかけの線は取りやめる)
		if (resized) {
			cancelStroke();
			init();
		}
	});
	c.on('deleted', payload => {
		cancelStroke();
		connection.value?.dispose();
		connection.value = null;
		if (deletingByMe) return;
		os.alert({ type: 'info', text: payload.byModerator ? i18n.ts._drawRoom.roomDeletedByModerator : i18n.ts._drawRoom.roomDeleted });
		router.push('/draw');
	});
	c.on('ended', payload => {
		if (room.value == null) return;
		cancelStroke();
		room.value = { ...payload.room, isMember: room.value.isMember, viewOnly: room.value.viewOnly };
		connection.value?.dispose();
		connection.value = null;
		// JUICE: 開催中だけの表示(開いている人・カーソル・ほかの人の描きかけの線・選択・操作の途中)を片付けて、
		// 読み込み直したときと同じ終了後の表示にする
		onlineUserIds.value = new Set();
		cursors.clear();
		const e = engine.value;
		if (e != null) for (const key of e.layerKeys) e.clearPending(key);
		selectGesture.value = null;
		fillGesture.value = null;
		if (moveDrag != null) finishMove(false);
		cancelRotateDrag();
		clearStrokeSelection();
		refreshLayerList();
	});
}

// JUICE: 切断中に届かなかった出来事は失われるので、再接続したら線とチャットを取り直す
function onStreamDisconnected(): void {
	wasDisconnected = true;
}

// JUICE: 別のタブ・アプリに移ったら、部屋を開いている人(オンライン)から外してもらう
function sendVisibility(): void {
	connection.value?.send('visibility', { visible: window.document.visibilityState === 'visible' });
}

// タブを閉じる・別のサイトへ移るときは、ページが閉じる前に離れたことを知らせる(すぐオフラインになるように)
function onPageHide(): void {
	connection.value?.send('visibility', { visible: false });
}

function onStreamConnected(): void {
	if (!wasDisconnected) return;
	wasDisconnected = false;
	// つなぎ直した接続は「見ている」状態から始まるので、離れているなら知らせ直す
	if (window.document.visibilityState !== 'visible') sendVisibility();
	if (room.value != null && !room.value.isEnded && connection.value != null) {
		// 取り直しに失敗しても、次の再接続でまた取り直す
		syncState(initGeneration).catch(() => {});
	}
}

function disposeRoom(): void {
	cursors.clear();
	strokeSelection.value = new Set();
	selectionShapes.value = [];
	onlineUserIds.value = new Set();
	connection.value?.dispose();
	connection.value = null;
	engine.value?.dispose();
	engine.value = null;
}

function scrollChatToBottom(): void {
	nextTick(() => {
		if (chatListEl.value) chatListEl.value.scrollTop = chatListEl.value.scrollHeight;
	});
}
//#endregion

//#region 表示(拡大縮小・移動)
// 利用者が拡大縮小・移動したか(していなければ、表示領域の大きさが変わったとき画面に合わせ直す)
let viewAdjusted = false;

function fitToScreen(): void {
	viewAdjusted = false;
	if (viewportEl.value == null || room.value == null) return;
	const rect = viewportEl.value.getBoundingClientRect();
	const scale = Math.min(rect.width / room.value.canvasWidth, rect.height / room.value.canvasHeight) * 0.96;
	view.rotation = 0;
	view.scale = scale;
	view.x = (rect.width - room.value.canvasWidth * scale) / 2;
	view.y = (rect.height - room.value.canvasHeight * scale) / 2;
}

//#region 全体マップ
const MINIMAP_UPDATE_INTERVAL_MS = 300;
const showMinimap = ref(true);

// 全体マップの大きさ(キャンバスの縦横比のまま、長い辺をTHUMBNAIL_MAX_SIZEにする)
const minimapSize = computed(() => {
	const e = engine.value;
	if (e == null) return { width: THUMBNAIL_MAX_SIZE, height: THUMBNAIL_MAX_SIZE };
	return { width: e.thumbWidth, height: e.thumbHeight };
});

// 今表示している範囲(表示領域の四隅をキャンバス座標にした四角形。回転していれば斜めになる)を全体マップ上の枠にする。
// 全体マップの外にはみ出す分は、枠の外側が切り取られて見える
// JUICE: 全体マップは回さず、枠をキャンバスを回したのと同じ向きに回す(見ている範囲の真ん中を中心に)。
// 枠の傾きで、今どちらへ回しているかが分かるようにする
const minimapFramePoints = computed(() => {
	if (view.scale <= 0) return '';
	const w = viewportSize.width;
	const h = viewportSize.height;
	const [cx, cy] = viewToCanvas(w / 2, h / 2);
	const hw = w / 2 / view.scale;
	const hh = h / 2 / view.scale;
	const cos = Math.cos(view.rotation);
	const sin = Math.sin(view.rotation);
	return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => `${cx + x * cos - y * sin},${cy + x * sin + y * cos}`).join(' ');
});

// 線が続けて届いても、一定間隔でだけ描き直す
let minimapTimer: number | null = null;

function updateMinimap(): void {
	if (!showMinimap.value || minimapTimer != null) return;
	minimapTimer = window.setTimeout(() => {
		minimapTimer = null;
		if (minimapEl.value != null) engine.value?.renderThumbnail(minimapEl.value);
	}, MINIMAP_UPDATE_INTERVAL_MS);
}

watch(showMinimap, (value) => {
	if (value) updateMinimap();
});

let minimapPointerId: number | null = null;

// 全体マップ上の位置が表示の真ん中に来るよう移動する
function moveViewToMinimapPoint(ev: PointerEvent): void {
	const r = room.value;
	if (r == null) return;
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	const cx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) * r.canvasWidth;
	const cy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)) * r.canvasHeight;
	viewAdjusted = true;
	// キャンバス上の(cx, cy)が表示領域の真ん中に来るように(回転していてもその点を中心にする)
	const [ox, oy] = canvasToView(cx, cy);
	view.x += viewportSize.width / 2 - ox;
	view.y += viewportSize.height / 2 - oy;
}

function onMinimapPointerDown(ev: PointerEvent): void {
	(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
	minimapPointerId = ev.pointerId;
	moveViewToMinimapPoint(ev);
}

function onMinimapPointerMove(ev: PointerEvent): void {
	if (minimapPointerId !== ev.pointerId) return;
	moveViewToMinimapPoint(ev);
}

function onMinimapPointerUp(ev: PointerEvent): void {
	if (minimapPointerId === ev.pointerId) minimapPointerId = null;
}

// 表示領域は部屋を読み込んでから現れるので、現れたときから大きさを追う
watch(viewportEl, (el, _old, onCleanup) => {
	if (el == null) return;
	const observer = new ResizeObserver(() => {
		viewportSize.width = el.clientWidth;
		viewportSize.height = el.clientHeight;
		// 表示領域の大きさが変わったら(ウインドウ・デッキの列の大きさの変更を含む)画面に合わせ直す。
		// ただし拡大・移動していたら崩さない(スマホでキーボードが出たときに、見ていた位置がリセットされないように)
		if (!viewAdjusted) fitToScreen();
	});
	observer.observe(el);
	onCleanup(() => observer.disconnect());
});

function cancelMinimapUpdate(): void {
	if (minimapTimer != null) window.clearTimeout(minimapTimer);
	minimapTimer = null;
}
//#endregion

function zoomAt(clientX: number, clientY: number, factor: number): void {
	if (viewportEl.value == null) return;
	const rect = viewportEl.value.getBoundingClientRect();
	const px = clientX - rect.left;
	const py = clientY - rect.top;
	viewAdjusted = true;
	// ドット絵を描けるよう、32倍まで拡大できる
	const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
	const actual = next / view.scale;
	view.x = px - (px - view.x) * actual;
	view.y = py - (py - view.y) * actual;
	view.scale = next;
}

// JUICE: 表示領域上の点(clientX, clientY)を中心に、キャンバスを回転する
function rotateAt(clientX: number, clientY: number, angle: number): void {
	if (viewportEl.value == null || angle === 0) return;
	const rect = viewportEl.value.getBoundingClientRect();
	const px = clientX - rect.left;
	const py = clientY - rect.top;
	viewAdjusted = true;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dx = view.x - px;
	const dy = view.y - py;
	view.x = px + dx * cos - dy * sin;
	view.y = py + dx * sin + dy * cos;
	// -π〜πに収める
	view.rotation = Math.atan2(Math.sin(view.rotation + angle), Math.cos(view.rotation + angle));
}

// 表示領域の真ん中を中心に回転する(PCのボタン用)
function rotateBy(angle: number): void {
	if (viewportEl.value == null) return;
	const rect = viewportEl.value.getBoundingClientRect();
	rotateAt(rect.left + rect.width / 2, rect.top + rect.height / 2, angle);
}

function resetRotation(): void {
	rotateBy(-view.rotation);
	view.rotation = 0;
}

const ROTATE_STEP = Math.PI / 12; // 15°
// バケツで「似た色」とみなす差(0〜255)
const BUCKET_TOLERANCE = 48;

// JUICE: 隙間閉じ。閉じる隙間の幅(の半分)は、キャンバスが大きいほど太い線に合わせて広げる
const gapClose = prefer.model('drawRoomGapClose');
const GAP_CLOSE_BASE = { off: 0, small: 2, medium: 5, large: 10 } as const;

function gapClosePixels(): number {
	const e = engine.value;
	const base = GAP_CLOSE_BASE[gapClose.value];
	if (e == null || base === 0) return 0;
	return Math.round(base * Math.max(1, Math.max(e.width, e.height) / 1600));
}

function gapCloseLabel(value: typeof gapClose.value): string {
	return {
		off: i18n.ts._drawRoom.gapCloseOff,
		small: i18n.ts._drawRoom.gapCloseSmall,
		medium: i18n.ts._drawRoom.gapCloseMedium,
		large: i18n.ts._drawRoom.gapCloseLarge,
	}[value];
}

function openGapCloseMenu(ev: MouseEvent): void {
	os.popupMenu([
		{ type: 'label', text: i18n.ts._drawRoom.gapClose },
		...(['off', 'small', 'medium', 'large'] as const).map(value => ({
			text: gapCloseLabel(value),
			icon: gapClose.value === value ? 'ti ti-check' : undefined,
			active: gapClose.value === value,
			action: () => { gapClose.value = value; },
		})),
	], (ev.currentTarget ?? ev.target) as HTMLElement);
}

const rotationDegrees = computed(() => Math.round((view.rotation * 180) / Math.PI));

// 指で回したとき、0°・90°・180°・270°の近くなら、その角度にそろえる
const ROTATE_SNAP = (10 * Math.PI) / 180;

function snapRotation(): void {
	const quarter = Math.PI / 2;
	const nearest = Math.round(view.rotation / quarter) * quarter;
	if (Math.abs(view.rotation - nearest) < ROTATE_SNAP) rotateBy(nearest - view.rotation);
}

function onWheel(ev: WheelEvent): void {
	// Ctrl付き(トラックパッドのピンチもCtrl付きのwheelとして届く)は拡大縮小。
	// それ以外は、設定によってホイールで拡大縮小するか移動する(Shiftを押していれば移動)
	if (ev.ctrlKey || ev.metaKey) {
		zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.01));
	} else if (wheelZoom.value && !ev.shiftKey) {
		zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0015));
	} else {
		viewAdjusted = true;
		// Shift+ホイール(縦方向しか無いマウス)は横に動かす
		const horizontal = ev.shiftKey && ev.deltaX === 0;
		view.x -= horizontal ? ev.deltaY : ev.deltaX;
		view.y -= horizontal ? 0 : ev.deltaY;
	}
}

//#region 拡大縮小(JUICE: PCで操作しやすいよう、ボタン・倍率の選択・キーボードでも変えられる)
const ZOOM_STEP = 1.25;
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const MAX_ZOOM = 32;
const MIN_ZOOM = 0.1;

// JUICE: 表示の好み(プロファイルに覚える。バックアップ・復元で戻る)。ほかの人のカーソルの表示・濃さ、横のパネルをしまう
const showCursors = prefer.model('drawRoomShowCursors');

//#region デバッグ情報(JUICE)
const showDebugInfo = prefer.model('drawRoomShowDebugInfo');
type DebugInfo = {
	myStrokes: number;
	myBytes: number;
	layers: { name: string; strokes: number }[];
	roomStrokes: number;
	roomLayers: number;
	pending: number;
	lastRedrawMs: number;
	lastRedrawFull: boolean;
	lastRenderMs: number;
};
const debugInfo = ref<DebugInfo | null>(null);

// 上限に達した知らせを最後に出した時刻
let lastLimitToastAt = 0;

// 描ける線の上限(サーバーと同じく、ロールの値を範囲に収めたもの)
const strokeLimits = computed(() => ({
	strokes: Math.max(1, Math.min(200000, Math.floor(Number.isFinite($i.policies.drawRoomMaxStrokes) ? $i.policies.drawRoomMaxStrokes : 30000))),
	megabytes: Math.max(1, Math.min(128, Math.floor(Number.isFinite($i.policies.drawRoomMaxStrokeMegabytes) ? $i.policies.drawRoomMaxStrokeMegabytes : 64))),
}));

// 線のデータ量の見積もり(サーバーに保存する形のJSONの大きさ。点1つが5バイトで、base64にすると4/3倍)
function estimateStrokeBytes(stroke: CanvasStroke): number {
	const base64 = (points: number) => Math.ceil((Math.floor(points / 3) * 5) / 3) * 4;
	return 140 + base64(stroke.points.length) + (stroke.clip != null ? base64(stroke.clip.length) : 0);
}

function updateDebugInfo(): void {
	const e = engine.value;
	if (e == null || !showDebugInfo.value) {
		debugInfo.value = null;
		return;
	}
	let myStrokes = 0;
	let myBytes = 0;
	const layers = myLayers.value.map(meta => {
		const strokes = e.strokesOf(keyFor($i.id, meta.id));
		myStrokes += strokes.length;
		for (const stroke of strokes) myBytes += estimateStrokeBytes(stroke);
		return { name: layerName($i.id, meta), strokes: strokes.length };
	});
	const summary = e.debugSummary();
	debugInfo.value = {
		myStrokes,
		myBytes,
		layers,
		roomStrokes: summary.strokes,
		roomLayers: summary.layers,
		pending: summary.pending,
		lastRedrawMs: e.stats.lastRedrawMs,
		lastRedrawFull: e.stats.lastRedrawFull,
		lastRenderMs: e.stats.lastRenderMs,
	};
}

useInterval(updateDebugInfo, 1000, { immediate: true, afterMounted: true });
watch(showDebugInfo, updateDebugInfo);

function formatMegabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

//#endregion
const cursorOpacity = computed({
	get: () => Math.min(1, Math.max(0.1, prefer.r.drawRoomCursorOpacity.value)),
	set: (v: number) => prefer.commit('drawRoomCursorOpacity', v),
});
const sideHidden = prefer.model('drawRoomSideHidden');

// JUICE: 横のパネルの幅と、レイヤーとチャットの高さの割合(PCだけ。つまみをドラッグして変えられる)
const SIDE_WIDTH_MIN = 260;
const SIDE_WIDTH_MAX = 560;
const LAYERS_RATIO_MIN = 0.15;
const LAYERS_RATIO_MAX = 0.85;
const clampSideWidth = (v: number) => Math.round(Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, v)));
const clampLayersRatio = (v: number) => Math.min(LAYERS_RATIO_MAX, Math.max(LAYERS_RATIO_MIN, v));
// ドラッグしている間は、この画面の中だけで変え、止めて少ししてからプロファイルに書く(動かすたびに書かないように)
const sideWidth = ref(clampSideWidth(prefer.s.drawRoomSideWidth));
const layersRatio = ref(clampLayersRatio(prefer.s.drawRoomLayersRatio));
let sideSizeSaveTimer: number | null = null;
watch([sideWidth, layersRatio], () => {
	if (sideSizeSaveTimer != null) window.clearTimeout(sideSizeSaveTimer);
	sideSizeSaveTimer = window.setTimeout(() => {
		sideSizeSaveTimer = null;
		if (prefer.s.drawRoomSideWidth !== sideWidth.value) prefer.commit('drawRoomSideWidth', sideWidth.value);
		if (prefer.s.drawRoomLayersRatio !== layersRatio.value) prefer.commit('drawRoomLayersRatio', layersRatio.value);
	}, 500);
});
// 書く前にページを離れても、変えた幅・割合を残す
onUnmounted(() => {
	if (sideSizeSaveTimer == null) return;
	window.clearTimeout(sideSizeSaveTimer);
	sideSizeSaveTimer = null;
	if (prefer.s.drawRoomSideWidth !== sideWidth.value) prefer.commit('drawRoomSideWidth', sideWidth.value);
	if (prefer.s.drawRoomLayersRatio !== layersRatio.value) prefer.commit('drawRoomLayersRatio', layersRatio.value);
});
const sideEl = useTemplateRef('sideEl');
// つまみがどのパネルを調整するかを伝えるためのid
const sideId = useId();
const layersPanelId = useId();
const chatPanelId = useId();

// つまみを押している間、ポインターの動きに合わせてonMoveを呼ぶ
function dragHandle(ev: PointerEvent, onMove: (e: PointerEvent) => void): void {
	if (ev.button !== 0) return;
	ev.preventDefault();
	const handle = ev.currentTarget as HTMLElement;
	handle.setPointerCapture(ev.pointerId);
	const end = () => {
		handle.removeEventListener('pointermove', onMove);
		handle.removeEventListener('pointerup', end);
		handle.removeEventListener('pointercancel', end);
	};
	handle.addEventListener('pointermove', onMove);
	handle.addEventListener('pointerup', end);
	handle.addEventListener('pointercancel', end);
}

function startSideResize(ev: PointerEvent): void {
	const startX = ev.clientX;
	const startWidth = sideWidth.value;
	// パネルは右側にあるので、左へ動かすと広がる
	dragHandle(ev, e => { sideWidth.value = clampSideWidth(startWidth + (startX - e.clientX)); });
}

function startSplitResize(ev: PointerEvent): void {
	const el = sideEl.value;
	if (el == null) return;
	dragHandle(ev, e => {
		const rect = el.getBoundingClientRect();
		if (rect.height > 0) layersRatio.value = clampLayersRatio((e.clientY - rect.top) / rect.height);
	});
}

// ホイールだけで拡大縮小するか(オフならホイールは移動、拡大縮小はCtrl+ホイール)。プロファイルに覚える
const wheelZoom = prefer.model('drawRoomWheelZoom');

// 表示領域の真ん中を中心に拡大縮小する
function zoomBy(factor: number): void {
	if (viewportEl.value == null) return;
	const rect = viewportEl.value.getBoundingClientRect();
	zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function setZoom(scale: number): void {
	zoomBy(scale / view.scale);
}

// JUICE: 倍率のスライダー(倍率の2を底とする対数)
const ZOOM_SLIDER_MIN = Math.log2(MIN_ZOOM);
const ZOOM_SLIDER_MAX = Math.log2(MAX_ZOOM);
const zoomSlider = computed({
	get: () => Math.log2(view.scale),
	set: (value: number) => setZoom(2 ** value),
});

function openZoomMenu(ev: MouseEvent): void {
	os.popupMenu([{
		text: i18n.ts._drawRoom.fitToScreen,
		icon: 'ti ti-arrows-minimize',
		action: fitToScreen,
	}, {
		text: i18n.ts._drawRoom.resetRotation,
		icon: 'ti ti-rotate-clockwise',
		action: resetRotation,
	// JUICE: 倍率は選んだらメニューを閉じる(開いたままだと、今の倍率の印が古いまま残って分かりにくい)
	}, { type: 'divider' }, ...ZOOM_PRESETS.map(scale => {
		const current = Math.abs(view.scale - scale) < 0.005;
		return {
			text: `${scale * 100}%`,
			icon: current ? 'ti ti-check' : 'ti ti-zoom-in',
			active: current,
			action: () => setZoom(scale),
		};
	})], (ev.currentTarget ?? ev.target) as HTMLElement);
}

// JUICE: 表示の設定(ホイールでの拡大縮小・ピクセルアート拡大モード・ほかの人のカーソル・デバッグ情報)は「…」のメニューにまとめる
function openViewMenu(ev: MouseEvent): void {
	os.popupMenu([{
		type: 'switch',
		text: i18n.ts._drawRoom.wheelZoom,
		ref: wheelZoom,
	}, {
		type: 'switch',
		text: i18n.ts.pixelatedZoom,
		ref: dotView,
	}, { type: 'divider' }, {
		// JUICE: ほかの人のカーソルの表示・濃さ
		type: 'switch',
		text: i18n.ts._drawRoom.showCursors,
		ref: showCursors,
	}, {
		type: 'radio',
		text: i18n.ts._drawRoom.cursorOpacity,
		ref: cursorOpacity,
		options: [1, 0.7, 0.4, 0.2].map(value => ({ label: `${value * 100}%`, value })),
	}, { type: 'divider' }, {
		// JUICE: 線の本数・データ量などのデバッグ情報
		type: 'switch',
		text: i18n.ts._drawRoom.showDebugInfo,
		ref: showDebugInfo,
	}], (ev.currentTarget ?? ev.target) as HTMLElement);
}

// スペースを押している間は、左ドラッグでも表示を移動する
const spaceHeld = ref(false);

function onKeyup(ev: KeyboardEvent): void {
	if (ev.key === ' ') spaceHeld.value = false;
}

function onWindowBlur(): void {
	spaceHeld.value = false;
}
//#endregion
//#endregion

//#region 描く
type ActiveStroke = {
	id: string;
	tool: DrawTool;
	color: string;
	size: number;
	// 1未満のときだけ入れる(不透明な線は今までどおりのデータにする)
	opacity?: number;
	// 普通の筆でなければ筆の種類
	brush?: 'soft' | 'dot';
	// 線の中だけ塗るときの、塗れる範囲の多角形
	clip?: number[];
	// JUICE: どのレイヤーの線か(最初のレイヤーなら無し)
	layer?: string;
	// JUICE: 透明度ロック
	lock?: boolean;
	// JUICE: 筆圧で何を変えるか(無ければ太さだけ)
	pressure?: CanvasStroke['pressure'];
	points: number[];
	// まだ送っていない点が始まる位置(points内のindex)
	sentIndex: number;
	pointerId: number;
};

let activeStroke: ActiveStroke | null = null;
let sendTimer: number | null = null;
// タッチ操作中の指(2本指での拡大縮小・移動用)
const touches = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; centerX: number; centerY: number; angle: number; twist: number; rotating: boolean } | null = null;
// JUICE: 2本指で拡大縮小するだけのつもりで少しひねれてしまっても回らないよう、これ以上ひねったら回し始める
const PINCH_ROTATE_START = (15 * Math.PI) / 180;

function newStrokeId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ドラッグがキャンバスの外まで続いた場合も、サーバーが受け付ける範囲(キャンバスの少し外側まで)に収める
const CANVAS_OVERFLOW_MARGIN = 100;

// JUICE: 描いている間はキャンバスの位置を1回だけ測って使い回す。ペンの点ごとに測ると、ほかの人のカーソルの
// 表示などで画面が変わっているたびにページ全体の配置の計算が走り、描くのが遅れるため
let canvasRectCache: DOMRect | null = null;
watch(() => [view.x, view.y, view.scale, view.rotation], () => {
	canvasRectCache = null;
});

// 表示領域の位置(キャンバスが回転していても変わらないので、座標の計算は表示領域を基準にする)
function viewportRect(): DOMRect {
	if (activeStroke == null) return viewportEl.value!.getBoundingClientRect();
	canvasRectCache ??= viewportEl.value!.getBoundingClientRect();
	return canvasRectCache;
}

function toCanvasPoint(ev: PointerEvent): [number, number] {
	const rect = viewportRect();
	const e = engine.value!;
	const clamp = (v: number, max: number) => Math.min(max + CANVAS_OVERFLOW_MARGIN, Math.max(-CANVAS_OVERFLOW_MARGIN, v));
	const [x, y] = viewToCanvas(ev.clientX - rect.left, ev.clientY - rect.top);
	return [
		// 送る形式と同じ細かさ(1/8px)にそろえる
		Math.round(clamp(x, e.width) * POINT_SCALE) / POINT_SCALE,
		Math.round(clamp(y, e.height) * POINT_SCALE) / POINT_SCALE,
	];
}

// ペンは筆圧をそのまま使う。マウス・指は筆圧を持たないので一定の太さ(=1)にする
function pressureOf(ev: PointerEvent): number {
	if (ev.pointerType !== 'pen') return 1;
	// 送る形式(0〜255)と同じ細かさにして、自分の画面とほかの人の画面で線の太さがずれないようにする
	return Math.round(Math.min(1, Math.max(0, ev.pressure)) * 255) / 255;
}

// 今選んでいる道具で描く線の設定
type StrokeStyle = Pick<ActiveStroke, 'tool' | 'color' | 'size' | 'opacity' | 'brush' | 'clip' | 'layer' | 'lock' | 'pressure'>;

function currentStrokeStyle(): StrokeStyle {
	const drawTool: DrawTool = tool.value === 'eraser' ? 'eraser' : 'pen';
	return {
		tool: drawTool,
		color: drawTool === 'eraser' ? '#000000' : color.value,
		size: size.value,
		...(opacity.value < 100 ? { opacity: opacity.value / 100 } : {}),
		...(brushType.value === 'soft' || brushType.value === 'dot' ? { brush: brushType.value } : {}),
		...(activeLayerId.value !== '0' ? { layer: activeLayerId.value } : {}),
		// JUICE: 透明度ロック(ペンのときだけ)
		...(alphaLock.value && drawTool === 'pen' ? { lock: true } : {}),
		// JUICE: 筆圧で何を変えるか(太さだけのときは省く。以前からの線と同じ)
		...(pressureMode.value !== 'size' ? { pressure: pressureMode.value } : {}),
	};
}

function strokeStyleOf(stroke: ActiveStroke): StrokeStyle {
	return {
		tool: stroke.tool,
		color: stroke.color,
		size: stroke.size,
		...(stroke.opacity != null ? { opacity: stroke.opacity } : {}),
		...(stroke.brush != null ? { brush: stroke.brush } : {}),
		...(stroke.clip != null ? { clip: stroke.clip } : {}),
		...(stroke.layer != null ? { layer: stroke.layer } : {}),
		...(stroke.lock === true ? { lock: true } : {}),
		...(stroke.pressure != null ? { pressure: stroke.pressure } : {}),
	};
}

/**
 * JUICE: 線の中だけ塗る(はみ出し防止)で、描き始めた所を囲んでいる範囲を求める(バケツと同じ求め方)。
 * 囲まれていなければ(キャンバス全体なら)、範囲はキャンバス全体になる
 */
function clipRegionAt(x: number, y: number): number[] | undefined {
	const e = engine.value;
	if (e == null) return undefined;
	const px = Math.floor(x);
	const py = Math.floor(y);
	if (px < 0 || py < 0 || px >= e.width || py >= e.height) return undefined;
	const mask = floodFillMask(e.referenceImage(), px, py, BUCKET_TOLERANCE, gapClosePixels());
	if (mask == null) return undefined;
	// 線の縁の下まで塗れるよう少し広げる
	const points = maskToFillPoints(dilateMask(mask, e.width, e.height, 1), e.width, e.height, STROKE_MAX_POINTS);
	// 範囲が複雑すぎて形にできないときは、はみ出さないようにできないことを知らせる(線はそのまま描ける)
	if (points == null) os.toast(i18n.ts._drawRoom.clipTooComplex);
	return points ?? undefined;
}

function startStroke(ev: PointerEvent): void {
	canvasRectCache = null;
	const [x, y] = toCanvasPoint(ev);
	const clip = clipToLines.value ? clipRegionAt(x, y) : undefined;
	activeStroke = {
		id: newStrokeId(),
		...currentStrokeStyle(),
		...(clip != null ? { clip } : {}),
		points: [x, y, pressureOf(ev)],
		sentIndex: 0,
		pointerId: ev.pointerId,
	};
	showActiveStroke(0);
	scheduleSend();
}

// 描いている途中の線を自分の画面にも表示する(新しく増えた点だけを渡す)
function showActiveStroke(fromIndex: number): void {
	if (activeStroke == null || engine.value == null) return;
	engine.value.addStrokePart(activeKey.value, {
		id: activeStroke.id,
		...strokeStyleOf(activeStroke),
		points: activeStroke.points.slice(fromIndex),
	});
}

function scheduleSend(): void {
	if (sendTimer != null) return;
	sendTimer = window.setTimeout(() => {
		sendTimer = null;
		sendStrokePart();
		if (activeStroke != null) scheduleSend();
	}, STROKE_PART_INTERVAL_MS);
}

function sendStrokePart(): void {
	if (activeStroke == null || connection.value == null) return;
	while (activeStroke.sentIndex < activeStroke.points.length) {
		const end = Math.min(activeStroke.points.length, activeStroke.sentIndex + STROKE_PART_MAX_POINTS * 3);
		const { clip, ...style } = strokeStyleOf(activeStroke);
		connection.value.send('strokePart', {
			strokeId: activeStroke.id,
			...style,
			// 塗れる範囲は大きいので、最初の分にだけ付ける
			...(clip != null && activeStroke.sentIndex === 0 ? { clip: encodePoints(clip) } : {}),
			points: encodePoints(activeStroke.points.slice(activeStroke.sentIndex, end)),
		});
		activeStroke.sentIndex = end;
	}
}

// 描き終わった線を確定させて送る
function finishStroke(): void {
	if (activeStroke == null) return;
	const stroke: CanvasStroke = {
		id: activeStroke.id,
		...strokeStyleOf(activeStroke),
		points: activeStroke.points,
	};
	activeStroke = null;
	if (sendTimer != null) {
		window.clearTimeout(sendTimer);
		sendTimer = null;
	}
	engine.value?.addStroke(activeKey.value, stroke);
	connection.value?.send('stroke', encodeStroke(stroke));
	if (stroke.tool === 'pen') rememberRecentColor(stroke.color);
	if (!layerUserIds.value.includes($i.id)) refreshLayerList();
}

// JUICE: 最近使った色(カラーパレットに並べる。プロファイルに覚える)
const RECENT_COLORS_MAX = 16;

function rememberRecentColor(value: string): void {
	const recent = prefer.s.drawRoomRecentColors;
	if (recent[0] === value) return;
	prefer.commit('drawRoomRecentColors', [value, ...recent.filter(c => c !== value)].slice(0, RECENT_COLORS_MAX));
}

// JUICE: カラーパレットを開く。選んだ色はすぐ使う(道具は持ち替えない)
function openColorPicker(ev: MouseEvent): void {
	const { dispose } = os.popup(defineAsyncComponent(() => import('./color-picker.vue')), {
		color: color.value,
		anchorElement: (ev.currentTarget ?? ev.target) as HTMLElement,
	}, {
		update: (value: string) => {
			color.value = value;
		},
		closed: () => dispose(),
	});
}

// 描きかけの線を取りやめる。途中までの線は皆の画面に届いているので、消してもらうよう知らせる
function cancelStroke(): void {
	if (activeStroke == null) return;
	const strokeId = activeStroke.id;
	engine.value?.removeStroke(activeKey.value, strokeId);
	activeStroke = null;
	if (sendTimer != null) {
		window.clearTimeout(sendTimer);
		sendTimer = null;
	}
	connection.value?.send('strokeCancel', { strokeId });
}

function onPointerDown(ev: PointerEvent): void {
	// 読み込み中は描けない(読み込み終わった線で上書きされるため)
	if (engine.value == null || canvasLoading.value != null) return;
	brushPanelOpen.value = false;
	if (ev.pointerType === 'touch') {
		touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		// 2本目の指が触れたら、描きかけの線は取り消して拡大縮小・移動に切り替える
		if (touches.size >= 2) {
			// 1本目の指で始めた操作(線・範囲選択・囲って塗る・移動・表示の移動など)は取りやめる
			cancelLongPress();
			pickingPointerId = null;
			cancelStroke();
			selectFrom = null;
			selectGesture.value = null;
			fillGesture.value = null;
			panFrom = null;
			if (moveDrag != null) finishMove(false);
			cancelRotateDrag();
			const [a, b] = [...touches.values()];
			pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2, angle: Math.atan2(b.y - a.y, b.x - a.x), twist: 0, rotating: false };
			return;
		}
	}
	// JUICE: なでるツール(見学者も)。左ドラッグでなでる
	if (petting.value && canPet.value && !spaceHeld.value && ev.button === 0 && !selecting.value) {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		petPointerId = ev.pointerId;
		sendCursor(ev, true);
		return;
	}
	// スペースを押している間と手のひらツールでは、左ドラッグで表示を移動する
	if ((spaceHeld.value || tool.value === 'hand') && ev.button === 0) {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		panFrom = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
		return;
	}
	if (selecting.value && ev.button === 0) {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		const [x, y] = canvasPointInside(ev);
		selectFrom = { x, y, pointerId: ev.pointerId };
		selection.value = null;
		return;
	}
	// 中ボタン・右ボタン、または描けない状態のドラッグは移動にする
	if (!canDraw.value || ev.button !== 0) {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		panFrom = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
		return;
	}
	// JUICE: 範囲選択・投げ縄選択・移動ツール
	// JUICE: 筆の種類が「囲って塗る」なら、なぞって囲った範囲をペンなら塗り、消しゴムなら消す
	if ((tool.value === 'pen' || tool.value === 'eraser') && brushType.value === 'area') {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		const [x, y] = toCanvasPoint(ev);
		fillGesture.value = { points: [x, y], pointerId: ev.pointerId };
		return;
	}
	if (tool.value === 'bucket') {
		bucketFill(ev);
		return;
	}
	if (tool.value === 'select' || tool.value === 'lasso') {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		const [x, y] = toCanvasPoint(ev);
		selectGesture.value = { kind: tool.value, points: [x, y], pointerId: ev.pointerId, additive: ev.shiftKey };
		return;
	}
	if (tool.value === 'move') {
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		const [x, y] = toCanvasPoint(ev);
		// 選んでいれば、選んだ形の境目で線を切ってから、囲んだ部分だけを動かす(選んでいなければレイヤー全体)
		const prepared = strokeSelection.value.size > 0 ? prepareSelection() : null;
		const ids = prepared?.ids ?? null;
		moveDrag = { startX: x, startY: y, pointerId: ev.pointerId, ids, splits: prepared?.splits ?? [] };
		engine.value.beginMove(activeKey.value, ids);
		return;
	}
	// スポイト(またはAltを押しながらクリック)は、その位置の色を拾う
	if (tool.value === 'eyedropper' || ev.altKey) {
		pickColorAt(ev);
		return;
	}
	(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
	startStroke(ev);
	// JUICE: 指で描き始めた所でしばらく止めていたら、スポイトにする(iPad等)
	if (ev.pointerType === 'touch' && (tool.value === 'pen' || tool.value === 'eraser')) startLongPress(ev);
}

//#region 長押しでスポイト(JUICE)
const LONG_PRESS_MS = 500;
// 長押しとみなす、指のぶれの大きさ(画面のpx)
const LONG_PRESS_MOVE_PX = 10;
let longPress: { pointerId: number; startX: number; startY: number; moved: number; last: PointerEvent; timer: number } | null = null;
// 長押しでスポイトにした指。離すまで、動かした先の色を拾い続ける
let pickingPointerId: number | null = null;

function startLongPress(ev: PointerEvent): void {
	cancelLongPress();
	const pointerId = ev.pointerId;
	longPress = {
		pointerId,
		startX: ev.clientX,
		startY: ev.clientY,
		moved: 0,
		last: ev,
		timer: window.setTimeout(() => {
			const press = longPress;
			longPress = null;
			if (press == null || press.pointerId !== pointerId) return;
			// 描き始めていた線は取りやめて、その位置の色を拾う
			if (activeStroke != null && activeStroke.pointerId === pointerId) cancelStroke();
			pickingPointerId = pointerId;
			pickColorAt(press.last);
		}, LONG_PRESS_MS),
	};
}

function cancelLongPress(): void {
	if (longPress == null) return;
	window.clearTimeout(longPress.timer);
	longPress = null;
}
//#endregion

function pickColorAt(ev: PointerEvent): void {
	if (engine.value == null) return;
	const [x, y] = toCanvasPoint(ev);
	const picked = engine.value.pickColor(x, y);
	if (picked == null) return;
	color.value = picked;
	// JUICE: スポイトの道具で拾ったら、その前に使っていた道具に戻す(Altを押しながらのときは道具はそのまま)
	if (tool.value === 'eyedropper') tool.value = toolBeforeEyedropper;
}

// JUICE: スポイトに持ち替える前の道具(色を拾った後に戻す)
let toolBeforeEyedropper: typeof tool.value = 'pen';
watch(tool, (value, old) => {
	if (value === 'eyedropper' && old !== 'eyedropper') toolBeforeEyedropper = old;
});

let panFrom: { x: number; y: number; pointerId: number } | null = null;

let lastCursorSentAt = 0;
let cursorShown = false;

// 自分のカーソルの位置をほかの人に送る(間引いて送る)
function sendCursor(ev: PointerEvent, force = false): void {
	if (connection.value == null || engine.value == null || room.value?.isEnded) return;
	const now = Date.now();
	if (!force && now - lastCursorSentAt < CURSOR_SEND_INTERVAL_MS) return;
	lastCursorSentAt = now;
	const [x, y] = toCanvasPoint(ev);
	// JUICE: なでている間は、なでていることも送る
	const pet = petPointerId === ev.pointerId;
	connection.value.send('cursor', { x, y, ...(pet ? { pet: true } : {}) });
	if (pet) spawnPetHeart($i.id, x, y);
	cursorShown = true;
}

function onPointerLeave(): void {
	if (!cursorShown || connection.value == null) return;
	cursorShown = false;
	connection.value.send('cursor', { x: null, y: null });
}

function onPointerMove(ev: PointerEvent): void {
	if (touches.size < 2) sendCursor(ev);
	if (ev.pointerType === 'touch' && touches.has(ev.pointerId)) {
		touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		if (pinch != null && touches.size >= 2) {
			const [a, b] = [...touches.values()];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			const centerX = (a.x + b.x) / 2;
			const centerY = (a.y + b.y) / 2;
			const angle = Math.atan2(b.y - a.y, b.x - a.x);
			viewAdjusted = true;
			view.x += centerX - pinch.centerX;
			view.y += centerY - pinch.centerY;
			if (pinch.distance > 0) zoomAt(centerX, centerY, distance / pinch.distance);
			// 2本指をひねった分だけ回転する(ひねりが小さいうちは回さない)
			const delta = Math.atan2(Math.sin(angle - pinch.angle), Math.cos(angle - pinch.angle));
			const twist = pinch.twist + delta;
			const rotating = pinch.rotating || Math.abs(twist) > PINCH_ROTATE_START;
			if (rotating) rotateAt(centerX, centerY, pinch.rotating ? delta : twist - Math.sign(twist) * PINCH_ROTATE_START);
			pinch = { distance, centerX, centerY, angle, twist, rotating };
			return;
		}
	}
	// JUICE: 長押しの途中で指が動いたら、長押しではない(そのまま線を描く)
	// (小さく塗り込んでいるときも長押しにしないよう、動いた距離の合計でも見る)
	if (longPress != null && longPress.pointerId === ev.pointerId) {
		longPress.moved += Math.hypot(ev.clientX - longPress.last.clientX, ev.clientY - longPress.last.clientY);
		if (Math.hypot(ev.clientX - longPress.startX, ev.clientY - longPress.startY) > LONG_PRESS_MOVE_PX || longPress.moved > LONG_PRESS_MOVE_PX * 2) cancelLongPress();
		else longPress.last = ev;
	}
	if (pickingPointerId != null && pickingPointerId === ev.pointerId) {
		pickColorAt(ev);
		return;
	}
	if (panFrom != null && panFrom.pointerId === ev.pointerId) {
		viewAdjusted = true;
		view.x += ev.clientX - panFrom.x;
		view.y += ev.clientY - panFrom.y;
		panFrom = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
		return;
	}
	if (selectFrom != null && selectFrom.pointerId === ev.pointerId) {
		updateSelection(ev);
		return;
	}
	if (fillGesture.value != null && fillGesture.value.pointerId === ev.pointerId) {
		const [x, y] = toCanvasPoint(ev);
		fillGesture.value.points = [...fillGesture.value.points, x, y];
		return;
	}
	if (selectGesture.value != null && selectGesture.value.pointerId === ev.pointerId) {
		const [x, y] = toCanvasPoint(ev);
		const gesture = selectGesture.value;
		// 範囲選択は始点と今の点だけ、投げ縄はなぞった点を全て持つ
		gesture.points = gesture.kind === 'select' ? [gesture.points[0], gesture.points[1], x, y] : [...gesture.points, x, y];
		return;
	}
	if (moveDrag != null && moveDrag.pointerId === ev.pointerId) {
		const [x, y] = toCanvasPoint(ev);
		moveOffset.x = x - moveDrag.startX;
		moveOffset.y = y - moveDrag.startY;
		engine.value?.updateMove(moveOffset.x, moveOffset.y);
		return;
	}
	if (activeStroke == null || activeStroke.pointerId !== ev.pointerId) return;
	// ペンの細かい動きも取りこぼさないよう、まとめて届いた途中の点も全て使う
	const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
	for (const e of events.length > 0 ? events : [ev]) {
		// 長すぎる線はサーバーが受け付けないので、上限に達する前に区切り、同じ位置から新しい線として続ける
		if (activeStroke.points.length >= STROKE_MAX_POINTS * 3) splitActiveStroke();
		const fromIndex = activeStroke.points.length;
		const [x, y] = toCanvasPoint(e);
		activeStroke.points.push(x, y, pressureOf(e));
		showActiveStroke(fromIndex);
	}
}

function splitActiveStroke(): void {
	if (activeStroke == null) return;
	const lastPoint = activeStroke.points.slice(-3);
	const pointerId = activeStroke.pointerId;
	// 区切った続きの線は、元の線と同じ設定で描く
	const style = strokeStyleOf(activeStroke);
	sendStrokePart();
	finishStroke();
	activeStroke = {
		id: newStrokeId(),
		...style,
		points: lastPoint,
		sentIndex: 0,
		pointerId,
	};
	showActiveStroke(0);
	scheduleSend();
}

function onPointerUp(ev: PointerEvent): void {
	if (ev.pointerType === 'touch') {
		touches.delete(ev.pointerId);
		if (touches.size < 2 && pinch != null) {
			pinch = null;
			snapRotation();
		}
	}
	if (longPress != null && longPress.pointerId === ev.pointerId) cancelLongPress();
	if (pickingPointerId != null && pickingPointerId === ev.pointerId) {
		pickingPointerId = null;
		return;
	}
	if (petPointerId != null && petPointerId === ev.pointerId) {
		petPointerId = null;
		// なで終わったことを送る(カーソルの表示を普通に戻す)
		sendCursor(ev, true);
		return;
	}
	if (panFrom != null && panFrom.pointerId === ev.pointerId) {
		panFrom = null;
		return;
	}
	if (selectFrom != null && selectFrom.pointerId === ev.pointerId) {
		if (ev.type !== 'pointercancel') updateSelection(ev);
		selectFrom = null;
		return;
	}
	if (fillGesture.value != null && fillGesture.value.pointerId === ev.pointerId) {
		const gesture = fillGesture.value;
		fillGesture.value = null;
		if (ev.type !== 'pointercancel') commitFill(gesture.points);
		return;
	}
	if (selectGesture.value != null && selectGesture.value.pointerId === ev.pointerId) {
		const gesture = selectGesture.value;
		selectGesture.value = null;
		if (ev.type !== 'pointercancel') finishSelectGesture(gesture);
		return;
	}
	if (moveDrag != null && moveDrag.pointerId === ev.pointerId) {
		finishMove(ev.type !== 'pointercancel');
		return;
	}
	if (activeStroke == null || activeStroke.pointerId !== ev.pointerId) return;
	if (ev.type === 'pointercancel') {
		cancelStroke();
		return;
	}
	sendStrokePart();
	finishStroke();
}

function undo(): void {
	if (!canDraw.value) return;
	connection.value?.send('undo', {});
}

// JUICE: 取り消した操作をやり直す
function redo(): void {
	if (!canDraw.value) return;
	connection.value?.send('redo', {});
}

async function clearMyLayer(): Promise<void> {
	const meta = myLayers.value.find(layer => layer.id === activeLayerId.value);
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx._drawRoom.clearMyLayerConfirm({ name: meta != null ? layerName($i.id, meta) : '' }) });
	if (canceled) return;
	// JUICE: 描いているレイヤーだけを消去する
	connection.value?.send('clearLayer', { layer: activeLayerId.value });
}

function onKeydown(ev: KeyboardEvent): void {
	const target = ev.target;
	if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') != null)) return;
	if (ev.key === 'Escape' && selecting.value) {
		cancelSelecting();
		return;
	}
	if (ev.key === 'Escape' && strokeSelection.value.size > 0) {
		clearStrokeSelection();
		return;
	}
	if ((ev.key === 'Delete' || ev.key === 'Backspace') && strokeSelection.value.size > 0) {
		ev.preventDefault();
		deleteSelectedStrokes();
		return;
	}
	// スペースを押している間は表示を移動(ページがスクロールしないようにする)。
	// ボタン等にフォーカスがあるときは、スペースでそれを押せるようにそのままにする
	if (ev.key === ' ' && !(target instanceof HTMLElement && target.closest('button, a, [role="button"], [role="menuitem"]') != null)) {
		ev.preventDefault();
		spaceHeld.value = true;
		return;
	}
	// Ctrl+＋/－で拡大縮小、Ctrl+0で画面に合わせる(ブラウザ自体の拡大縮小の代わりに)
	if ((ev.ctrlKey || ev.metaKey) && (ev.key === '+' || ev.key === '=' || ev.key === ';')) {
		ev.preventDefault();
		zoomBy(ZOOM_STEP);
		return;
	}
	if ((ev.ctrlKey || ev.metaKey) && ev.key === '-') {
		ev.preventDefault();
		zoomBy(1 / ZOOM_STEP);
		return;
	}
	if ((ev.ctrlKey || ev.metaKey) && ev.key === '0') {
		ev.preventDefault();
		fitToScreen();
		return;
	}
	// JUICE: Ctrl+Shift+Z・Ctrl+Yでやり直す
	if ((ev.ctrlKey || ev.metaKey) && ((ev.key.toLowerCase() === 'z' && ev.shiftKey) || ev.key.toLowerCase() === 'y')) {
		ev.preventDefault();
		redo();
	} else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
		ev.preventDefault();
		undo();
	} else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === 'i' && canDraw.value) {
		tool.value = 'eyedropper';
	} else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === 'h' && canDraw.value) {
		tool.value = 'hand';
	}
}
//#endregion

//#region 線の選択・移動(JUICE)
// 自分のレイヤーで選んでいる線のid
const strokeSelection = ref(new Set<string>());
// 範囲選択・投げ縄の途中(キャンバス座標の平らな配列)
const selectGesture = ref<{ kind: 'select' | 'lasso'; points: number[]; pointerId: number; additive: boolean } | null>(null);
let moveDrag: { startX: number; startY: number; pointerId: number; ids: Set<string> | null; splits: SelectionSplit[] } | null = null;
type SelectionSplit = { id: string; pieces: CanvasStroke[] };
// 選んだ後、まだ境目で線を切っていない(最初に動かす・消すときに切る。一度切ったら、次からは選んだ線をそのまま使う)
let selectionNeedsSplit = false;
// 移動ツールでドラッグしている間のずれ(選択範囲の枠もこの分ずらして表示する)
const moveOffset = reactive({ x: 0, y: 0 });
// 選んだときに囲んだ形(キャンバス座標の多角形。Shiftで足したときは複数)。線の範囲に合わせて縮めたりはせず、
// 囲んだ形のまま表示する
const selectionShapes = ref<number[][]>([]);

// 範囲選択は4つの角、投げ縄はなぞった点の多角形にする
function gestureShape(gesture: { kind: 'select' | 'lasso'; points: number[] }): number[] {
	const p = gesture.points;
	if (gesture.kind === 'select' && p.length >= 4) return [p[0], p[1], p[2], p[1], p[2], p[3], p[0], p[3]];
	return p;
}

const selectGestureShape = computed(() => (selectGesture.value == null ? [] : gestureShape(selectGesture.value)));

function toSvgPoints(shape: number[]): string {
	const pairs: string[] = [];
	for (let i = 0; i + 1 < shape.length; i += 2) pairs.push(`${shape[i]},${shape[i + 1]}`);
	return pairs.join(' ');
}

function finishSelectGesture(gesture: { kind: 'select' | 'lasso'; points: number[]; additive: boolean }): void {
	const e = engine.value;
	if (e == null) return;
	const p = gesture.points;
	let ids: string[];
	if (gesture.kind === 'select') {
		if (p.length < 4 || (Math.abs(p[2] - p[0]) < 2 && Math.abs(p[3] - p[1]) < 2)) {
			// クリックしただけなら選択を外す
			if (!gesture.additive) clearStrokeSelection();
			return;
		}
		ids = e.strokesInArea(activeKey.value, { rect: [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])] });
	} else {
		if (p.length < 6) {
			if (!gesture.additive) clearStrokeSelection();
			return;
		}
		ids = e.strokesInArea(activeKey.value, { polygon: p });
	}
	// Shiftを押しながら選ぶと、今の選択に足す
	const shape = gestureShape(gesture);
	selectionNeedsSplit = true;
	if (gesture.additive) {
		strokeSelection.value = new Set([...strokeSelection.value, ...ids]);
		if (ids.length > 0) selectionShapes.value = [...selectionShapes.value, shape];
	} else {
		strokeSelection.value = new Set(ids);
		// 線が1本も入っていなければ、何も選んでいない状態にする
		selectionShapes.value = ids.length > 0 ? [shape] : [];
	}
}

function clearStrokeSelection(): void {
	strokeSelection.value = new Set();
	selectionShapes.value = [];
	selectionNeedsSplit = false;
}

/**
 * 選んだ形の境目で線を切り(自分の画面にはすぐ反映する)、動かす・消す線のidを返す。
 * 切った内容は、動かす・消す操作と一緒にサーバーへ送る(サーバーが順に処理するように)
 */
function prepareSelection(): { ids: Set<string>; splits: SelectionSplit[] } {
	const e = engine.value;
	if (!selectionNeedsSplit || e == null) return { ids: new Set(strokeSelection.value), splits: [] };
	const { selected, splits } = e.splitByShapes(activeKey.value, selectionShapes.value, newStrokeId);
	e.replaceStrokes(activeKey.value, splits);
	strokeSelection.value = selected;
	selectionNeedsSplit = false;
	return { ids: new Set(selected), splits };
}

function encodeSplits(splits: SelectionSplit[]): { id: string; pieces: Misskey.entities.DrawStroke[] }[] {
	return splits.map(split => ({
		id: split.id,
		pieces: split.pieces.map(encodeStroke),
	}));
}

// 取り消し・消去で無くなった線を選択から外す
function pruneStrokeSelection(): void {
	if (strokeSelection.value.size === 0 || engine.value == null) return;
	const existing = engine.value.strokeIdsOf(activeKey.value);
	const kept = [...strokeSelection.value].filter(id => existing.has(id));
	if (kept.length === strokeSelection.value.size) return;
	if (kept.length === 0) clearStrokeSelection();
	else strokeSelection.value = new Set(kept);
}

function finishMove(apply: boolean): void {
	const drag = moveDrag;
	moveDrag = null;
	const e = engine.value;
	if (drag == null || e == null) return;
	const dx = Math.round(moveOffset.x * POINT_SCALE) / POINT_SCALE;
	const dy = Math.round(moveOffset.y * POINT_SCALE) / POINT_SCALE;
	moveOffset.x = 0;
	moveOffset.y = 0;
	e.endMove();
	const moved = apply && (dx !== 0 || dy !== 0);
	// 境目で線を切っただけでも(動かさなかった・取りやめた場合も)、切った内容はほかの人にも届ける
	if (!moved && drag.splits.length === 0) return;
	// 自分の画面にはすぐ反映し、ほかの人にはサーバー経由で届ける
	// レイヤー全体を動かすときも、描いているレイヤーの線だけを指定する(null はその人の全てのレイヤーになるため)
	const strokeIds = drag.ids == null ? [...e.strokeIdsOf(activeKey.value)] : [...drag.ids];
	// 動かす線が無ければ移動は送らない(空の指定はサーバーに断られるため)。境目で切った線があれば、置き換えだけ送る
	if (strokeIds.length === 0) {
		if (drag.splits.length > 0) connection.value?.send('replaceStrokes', { replacements: encodeSplits(drag.splits) });
		return;
	}
	if (moved) e.moveStrokes(activeKey.value, drag.ids, dx, dy);
	connection.value?.send('moveStrokes', {
		strokeIds,
		dx: moved ? dx : 0,
		dy: moved ? dy : 0,
		...(drag.splits.length > 0 ? { splits: encodeSplits(drag.splits) } : {}),
	});
	if (!moved) return;
	// 選んだ形も、線と一緒にずらす
	if (drag.ids != null) {
		selectionShapes.value = selectionShapes.value.map(shape => shape.map((v, i) => v + (i % 2 === 0 ? dx : dy)));
	}
}

async function deleteSelectedStrokes(): Promise<void> {
	if (strokeSelection.value.size === 0) return;
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts._drawRoom.deleteSelectedConfirm });
	if (canceled) return;
	// 選んだ形の境目で線を切ってから、囲んだ部分だけを消す
	const { ids, splits } = prepareSelection();
	engine.value?.deleteStrokes(activeKey.value, ids);
	if (ids.size > 0 || splits.length > 0) {
		connection.value?.send('deleteStrokes', {
			strokeIds: [...ids],
			...(splits.length > 0 ? { splits: encodeSplits(splits) } : {}),
		});
	}
	clearStrokeSelection();
}

// 描く道具に持ち替えたら、選択は外す
watch(tool, (value) => {
	if (value === 'pen' || value === 'eraser' || value === 'eyedropper' || value === 'bucket') clearStrokeSelection();
});

//#region 選んだ部分の回転(JUICE)
// 選んだ形の外枠(回転の中心と、つまみの位置に使う)
const selectionBox = computed(() => {
	if (selectionShapes.value.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const shape of selectionShapes.value) {
		for (let i = 0; i + 1 < shape.length; i += 2) {
			minX = Math.min(minX, shape[i]);
			maxX = Math.max(maxX, shape[i]);
			minY = Math.min(minY, shape[i + 1]);
			maxY = Math.max(maxY, shape[i + 1]);
		}
	}
	return { minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
});
const selectionPivot = computed(() => (selectionBox.value == null ? null : { x: selectionBox.value.cx, y: selectionBox.value.cy }));
// つまみをドラッグしている間の回転の角度(表示だけ。離したときに線を回転する)
const rotateDragAngle = ref(0);
let rotateDrag: { pointerId: number; startAngle: number; pivotX: number; pivotY: number; prepared: { ids: Set<string>; splits: SelectionSplit[] } } | null = null;

function onRotateHandleDown(ev: PointerEvent): void {
	const pivot = selectionPivot.value;
	const e = engine.value;
	if (pivot == null || e == null || !canDraw.value) return;
	(ev.currentTarget as Element).setPointerCapture(ev.pointerId);
	const [x, y] = toCanvasPoint(ev);
	const prepared = prepareSelection();
	rotateDrag = { pointerId: ev.pointerId, startAngle: Math.atan2(y - pivot.y, x - pivot.x), pivotX: pivot.x, pivotY: pivot.y, prepared };
	e.beginMove(activeKey.value, prepared.ids);
}

function onRotateHandleMove(ev: PointerEvent): void {
	if (rotateDrag == null || rotateDrag.pointerId !== ev.pointerId) return;
	const [x, y] = toCanvasPoint(ev);
	let angle = Math.atan2(y - rotateDrag.pivotY, x - rotateDrag.pivotX) - rotateDrag.startAngle;
	// Shiftを押していれば15°ずつ
	if (ev.shiftKey) angle = Math.round(angle / ROTATE_STEP) * ROTATE_STEP;
	rotateDragAngle.value = angle;
	engine.value?.updateRotate(angle, rotateDrag.pivotX, rotateDrag.pivotY);
}

// 回転のつまみを動かしている途中で、ページを離れた・部屋が終わったときに取りやめる
function cancelRotateDrag(): void {
	if (rotateDrag == null) return;
	rotateDrag = null;
	rotateDragAngle.value = 0;
	engine.value?.endMove();
}

function onRotateHandleUp(ev: PointerEvent): void {
	if (rotateDrag == null || rotateDrag.pointerId !== ev.pointerId) return;
	const drag = rotateDrag;
	rotateDrag = null;
	const angle = ev.type === 'pointercancel' ? 0 : rotateDragAngle.value;
	rotateDragAngle.value = 0;
	engine.value?.endMove();
	commitRotation(drag.prepared, angle, drag.pivotX, drag.pivotY);
}

// ボタンで回す(選んだ形の真ん中を中心に)
function rotateSelection(angle: number): void {
	const pivot = selectionPivot.value;
	if (pivot == null || !canDraw.value) return;
	commitRotation(prepareSelection(), angle, pivot.x, pivot.y);
}

/**
 * 選んだ線を回転した線に置き換える(自分の画面にはすぐ反映し、ほかの人にはサーバー経由で届ける)。
 * 選んだ直後で境目で線を切ったばかりなら、切った内容と回転をまとめて1回で送る
 */
function commitRotation(prepared: { ids: Set<string>; splits: SelectionSplit[] }, angle: number, pivotX: number, pivotY: number): void {
	const e = engine.value;
	if (e == null) return;
	const rotated = new Map<string, CanvasStroke>();
	if (angle !== 0) {
		for (const stroke of e.strokesOf(activeKey.value)) {
			if (!prepared.ids.has(stroke.id)) continue;
			rotated.set(stroke.id, {
				...stroke,
				id: newStrokeId(),
				points: rotatePoints(stroke.points, angle, pivotX, pivotY),
				...(stroke.clip != null ? { clip: rotatePoints(stroke.clip, angle, pivotX, pivotY) } : {}),
			});
		}
	}
	// 自分の画面: 選んだ線(切った後の線)を、回転した線に置き換える
	if (rotated.size > 0) e.replaceStrokes(activeKey.value, [...rotated].map(([id, stroke]) => ({ id, pieces: [stroke] })));
	// サーバー: 切ったばかりなら元の線からの置き換え、そうでなければ今の線からの置き換え
	const replacements: SelectionSplit[] = prepared.splits.length > 0
		? [
			...prepared.splits.map(split => ({ id: split.id, pieces: split.pieces.map(piece => rotated.get(piece.id) ?? piece) })),
			...[...rotated].filter(([id]) => !prepared.splits.some(split => split.pieces.some(piece => piece.id === id))).map(([id, stroke]) => ({ id, pieces: [stroke] })),
		]
		: [...rotated].map(([id, stroke]) => ({ id, pieces: [stroke] }));
	if (replacements.length > 0) connection.value?.send('replaceStrokes', { replacements: encodeSplits(replacements) });
	if (rotated.size === 0) return;
	// 選択も回転した線に移し、選んだ形も一緒に回す
	strokeSelection.value = new Set([...rotated.values()].map(stroke => stroke.id));
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	selectionShapes.value = selectionShapes.value.map(shape => shape.map((v, i) => {
		const x = (i % 2 === 0 ? v : shape[i - 1]) - pivotX;
		const y = (i % 2 === 0 ? shape[i + 1] : v) - pivotY;
		return i % 2 === 0 ? pivotX + x * cos - y * sin : pivotY + x * sin + y * cos;
	}));
}
//#endregion

//#region 囲って塗る・バケツ(JUICE)
// 囲って塗っている途中の形(キャンバス座標の平らな配列)
const fillGesture = ref<{ points: number[]; pointerId: number } | null>(null);

/**
 * 塗りつぶしの線(tool: 'fill')を描く。pointsは [x, y, …](輪郭の区切りの印付きなら [x, y, 印, …])
 */
function commitFillStroke(points: number[]): void {
	const e = engine.value;
	if (e == null || points.length < 9) return;
	// 消しゴムで囲ったときは、その範囲を消す
	const erase = tool.value === 'eraser';
	const stroke: CanvasStroke = {
		id: newStrokeId(),
		tool: erase ? 'eraser' : 'fill',
		...(erase ? { brush: 'area' as const } : {}),
		color: erase ? '#000000' : color.value,
		size: 1,
		...(opacity.value < 100 ? { opacity: opacity.value / 100 } : {}),
		...(activeLayerId.value !== '0' ? { layer: activeLayerId.value } : {}),
		...(alphaLock.value && !erase ? { lock: true } : {}),
		points,
	};
	e.addStroke(activeKey.value, stroke);
	connection.value?.send('stroke', encodeStroke(stroke));
	if (!erase) rememberRecentColor(stroke.color);
	if (!layerUserIds.value.includes($i.id)) refreshLayerList();
}

// 囲った形で塗る。点が多すぎれば間引く(1本の線の点の上限に収める)
function commitFill(xy: number[]): void {
	if (xy.length < 6) return;
	const count = xy.length / 2;
	const step = Math.ceil(count / STROKE_MAX_POINTS);
	const points: number[] = [];
	for (let i = 0; i < count; i += step) points.push(xy[i * 2], xy[i * 2 + 1], 1);
	commitFillStroke(points);
}

// バケツ: 表示している絵で、押した所と似た色でつながっている範囲を塗る
function bucketFill(ev: PointerEvent): void {
	const e = engine.value;
	if (e == null) return;
	const [x, y] = toCanvasPoint(ev);
	const px = Math.floor(x);
	const py = Math.floor(y);
	if (px < 0 || py < 0 || px >= e.width || py >= e.height) return;
	const image = e.referenceImage();
	const mask = floodFillMask(image, px, py, BUCKET_TOLERANCE, gapClosePixels());
	if (mask == null) return;
	// 線の縁のぼかしに塗り残しが出ないよう、少し広げてから輪郭を取る
	const points = maskToFillPoints(dilateMask(mask, e.width, e.height, 1), e.width, e.height, STROKE_MAX_POINTS);
	if (points == null) {
		os.toast(i18n.ts._drawRoom.bucketFillTooComplex);
		return;
	}
	commitFillStroke(points);
}
//#endregion

// JUICE: 部屋主が、ほかの人のレイヤーを消去する
async function clearLayerOf(userId: string): Promise<void> {
	const user = userMap.get(userId);
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx._drawRoom.clearLayerOfConfirm({ name: user?.name ?? user?.username ?? userId }) });
	if (canceled) return;
	connection.value?.send('clearLayerOf', { userId });
}
//#endregion

//#region レイヤー
function toggleLayer(userId: string): void {
	const hidden = new Set(hiddenLayers.value);
	if (hidden.has(userId)) hidden.delete(userId);
	else hidden.add(userId);
	hiddenLayers.value = hidden;
	engine.value?.setOwnerHidden(userId, hidden.has(userId));
}

watch(myLayerOnTop, (value) => {
	engine.value?.setMyLayerOnTop(value);
});
//#endregion

//#region 参加・部屋主の操作
async function join(): Promise<void> {
	await os.apiWithDialog('draw-rooms/join', { roomId: props.roomId });
	// JUICE: 参加できたかはサーバーの状態で確かめてから描けるようにする(サーバー側のストリームが
	// 参加を反映する前に描き始めると、その線が受け付けられないため)
	const r = await misskeyApi('draw-rooms/show', { roomId: props.roomId });
	if (room.value != null && room.value.id === r.id) room.value = r;
}

async function leave(): Promise<void> {
	cancelStroke();
	await os.apiWithDialog('draw-rooms/leave', { roomId: props.roomId });
	if (room.value != null) room.value = { ...room.value, isMember: false };
}

async function kick(userId: string): Promise<void> {
	const user = userMap.get(userId);
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._drawRoom.kickConfirm({ name: user?.name ?? user?.username ?? userId }),
	});
	if (canceled) return;
	await os.apiWithDialog('draw-rooms/kick', { roomId: props.roomId, userId });
}

async function openRoomSettings(): Promise<void> {
	if (room.value == null) return;
	const { canceled, result } = await os.form(i18n.ts._drawRoom.roomSettings, {
		title: {
			type: 'string',
			label: i18n.ts._drawRoom.roomTitle,
			required: true,
			default: room.value.title,
		},
		maxMembers: {
			type: 'number',
			label: i18n.ts._drawRoom.maxMembers,
			description: i18n.ts._drawRoom.maxMembersCaption,
			default: room.value.maxMembers,
			step: 1,
		},
		keepAfterEnd: {
			type: 'boolean',
			label: i18n.ts._drawRoom.keepAfterEnd,
			description: i18n.ts._drawRoom.keepAfterEndCaption,
			default: room.value.keepAfterEnd,
		},
		// JUICE: 注意書き(CW)とセンシティブ(NSFW)
		cw: {
			type: 'string',
			label: i18n.ts._drawRoom.roomCw,
			description: i18n.ts._drawRoom.roomCwCaption,
			required: false,
			default: room.value.cw ?? '',
		},
		isSensitive: {
			type: 'boolean',
			label: i18n.ts._drawRoom.roomSensitive,
			description: i18n.ts._drawRoom.roomSensitiveCaption,
			default: room.value.isSensitive,
		},
		canvasWidth: {
			type: 'number',
			label: i18n.ts._drawRoom.canvasWidth,
			description: i18n.tsx._drawRoom.canvasResizeCaption({ min: DRAW_ROOM_CANVAS_MIN_SIZE, max: Math.min(DRAW_ROOM_CANVAS_MAX_SIZE, $i.policies.drawRoomMaxCanvasSize) }),
			default: room.value.canvasWidth,
			step: 1,
		},
		canvasHeight: {
			type: 'number',
			label: i18n.ts._drawRoom.canvasHeight,
			default: room.value.canvasHeight,
			step: 1,
		},
	});
	if (canceled || !result.title || room.value == null) return;
	// ロールで決まっている上限までに収める(ただし、今の大きさのままなら上限を超えていても変えない)
	const limit = $i.policies.drawRoomMaxCanvasSize;
	const canvasWidth = result.canvasWidth === room.value.canvasWidth ? room.value.canvasWidth : clampCanvasSize(result.canvasWidth, room.value.canvasWidth, limit);
	const canvasHeight = result.canvasHeight === room.value.canvasHeight ? room.value.canvasHeight : clampCanvasSize(result.canvasHeight, room.value.canvasHeight, limit);
	// 小さくすると、はみ出した部分の線が見えなくなる(消えはしない)ので確認する
	if (canvasWidth < room.value.canvasWidth || canvasHeight < room.value.canvasHeight) {
		const { canceled: resizeCanceled } = await os.confirm({ type: 'warning', text: i18n.ts._drawRoom.canvasShrinkConfirm });
		if (resizeCanceled) return;
	}
	await os.apiWithDialog('draw-rooms/update', {
		roomId: props.roomId,
		title: result.title,
		maxMembers: clampMaxMembers(result.maxMembers, room.value.maxMembers),
		keepAfterEnd: result.keepAfterEnd,
		cw: result.cw?.trim() ? result.cw.trim().slice(0, 128) : null,
		isSensitive: result.isSensitive,
		...(canvasWidth !== room.value.canvasWidth ? { canvasWidth } : {}),
		...(canvasHeight !== room.value.canvasHeight ? { canvasHeight } : {}),
	});
}

async function endRoom(): Promise<void> {
	const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts._drawRoom.endRoomConfirm });
	if (canceled) return;
	await os.apiWithDialog('draw-rooms/end', { roomId: props.roomId });
}

// 自分で削除したときは、削除の知らせ(ストリーム)でダイアログを重ねて出さない
let deletingByMe = false;

// 部屋主は終了した部屋を、モデレーターは(開催中でも)問題のある部屋を削除する(モデレーターの削除はログに残る)
// JUICE: 保存しないで終了した部屋が削除されるまでの残り時間(分、切り上げ)。30秒ごとに更新する
const nowForDeletion = ref(Date.now());
useInterval(() => { nowForDeletion.value = Date.now(); }, 1000 * 30, { immediate: false, afterMounted: true });
const deletesInMinutes = computed(() => (room.value?.deletesAt == null ? null : Math.ceil((new Date(room.value.deletesAt).getTime() - nowForDeletion.value) / (1000 * 60))));

async function deleteRoom(confirmText: string = i18n.ts._drawRoom.deleteRoomConfirm): Promise<void> {
	const { canceled } = await os.confirm({ type: 'warning', text: confirmText });
	if (canceled) return;
	deletingByMe = true;
	try {
		await os.apiWithDialog('draw-rooms/delete', { roomId: props.roomId });
	} catch {
		deletingByMe = false;
		return;
	}
	router.push('/draw');
}

function deleteRoomAsModerator(): void {
	deleteRoom(i18n.ts._drawRoom.deleteRoomAsModeratorConfirm);
}

// JUICE: 部屋そのもの(部屋主)と、部屋のチャットの発言(発言した人)を通報する
async function openReportWindow(user: Misskey.entities.UserLite, extra: { drawRoomChatMessageId?: string }): Promise<void> {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkAbuseReportWindow.vue').then(x => x.default), {
		user,
		initialComment: `${url}/draw/${props.roomId}\n-----\n`,
		drawRoomId: props.roomId,
		...extra,
	}, {
		closed: () => dispose(),
	});
}

function reportRoom(): void {
	if (room.value == null) return;
	openReportWindow(room.value.owner, {});
}

function openChatMenu(ev: MouseEvent, item: { message: Misskey.entities.DrawRoomChatMessage; user: Misskey.entities.UserLite }): void {
	os.popupMenu([{
		text: i18n.ts.reportAbuse,
		icon: 'ti ti-exclamation-circle',
		danger: true,
		action: () => openReportWindow(item.user, { drawRoomChatMessageId: item.message.id }),
	}], (ev.currentTarget ?? ev.target) as HTMLElement);
}
//#endregion

//#region 完成画像
type ImageArea = { x: number; y: number; width: number; height: number };

// JUICE: 保存する画像の形式。PNG(劣化なし。画素はそのまま)・WebP(Misskeyのアップロード時の圧縮と同じ)・JPEG から選べる。
// 選んだ形式はプロファイルに覚える
const imageFormat = prefer.model('drawRoomImageFormat');
const imageFormatOptions = computed(() => [
	{ label: i18n.ts._drawRoom.formatPng, value: 'png' as const },
	{ label: i18n.ts._drawRoom.formatWebp, value: 'webp' as const },
	{ label: i18n.ts._drawRoom.formatJpeg, value: 'jpeg' as const },
]);

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Failed to export the image'))), type, quality);
	});
}

// 縦横比を保ったまま、最大の大きさに収まるよう縮小したキャンバス(収まっていればそのまま)
function fitCanvas(canvas: HTMLCanvasElement, maxWidth: number, maxHeight: number): HTMLCanvasElement {
	const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height);
	if (scale >= 1) return canvas;
	const out = window.document.createElement('canvas');
	out.width = Math.max(1, Math.round(canvas.width * scale));
	out.height = Math.max(1, Math.round(canvas.height * scale));
	const ctx = out.getContext('2d')!;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(canvas, 0, 0, out.width, out.height);
	return out;
}

/**
 * 全体(または選んだ範囲)を、選んでいる形式の画像にする
 */
async function exportImage(area?: ImageArea | null): Promise<{ blob: Blob; ext: string } | null> {
	if (engine.value == null) return null;
	const canvas = engine.value.renderImage(area ?? undefined);
	switch (imageFormat.value) {
		case 'png': {
			// ブラウザのPNGは可逆圧縮なので画素はそのまま。画素を読み出して自前で組み立てるより、
			// 画面を固めずに(読み出し・圧縮はブラウザが裏で行う)、ファイルも小さくできる
			return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
		}
		case 'jpeg': {
			return { blob: await canvasToBlob(canvas, 'image/jpeg', 0.92), ext: 'jpg' };
		}
		case 'webp': {
			// アップロード時の「画像の圧縮」設定の大きさまで縮小する(圧縮しない設定なら、標準の段階を使う)
			const settings = getCompressionSettings(prefer.s.defaultImageCompressionLevel === 0 ? 1 : prefer.s.defaultImageCompressionLevel);
			const webp = isWebpSupported();
			// 一度PNGにしてから読み直さず、キャンバスから直接縮小・圧縮する
			const source = fitCanvas(canvas, settings?.maxWidth ?? canvas.width, settings?.maxHeight ?? canvas.height);
			const blob = await canvasToBlob(source, webp ? 'image/webp' : 'image/jpeg', webp ? 0.85 : 0.8);
			return { blob, ext: webp ? 'webp' : 'jpg' };
		}
	}
}

// 保存するたびに名前が変わるよう、部屋の名前に日時を付ける
function imageFileName(ext: string): string {
	const title = (room.value?.title ?? i18n.ts._drawRoom.title).replace(/[\\/:*?"<>|]/g, '_');
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${title}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

// ドライブへは作った画像をそのまま送る(アップロード時の縮小・再圧縮はしない)
async function uploadImage(area?: ImageArea | null): Promise<Misskey.entities.DriveFile | null> {
	const image = await exportImage(area);
	if (image == null) return null;
	// JUICE: センシティブ(NSFW)の部屋の絵は、センシティブなファイルとして上げる
	return await uploadFile(image.blob, { name: imageFileName(image.ext), isSensitive: room.value?.isSensitive === true }).filePromise;
}

async function saveImageToDrive(area?: ImageArea | null): Promise<void> {
	const file = await os.promiseDialog(uploadImage(area));
	if (file == null) return;
	os.toast(i18n.ts._drawRoom.imageSaved);
	cancelSelecting();
}

// JUICE: この部屋のURL
function roomUrl(): string {
	return `${url}/draw/${props.roomId}`;
}

// JUICE: 共有するときの文(部屋の名前とURL)。保存しないで終了した部屋は、まもなく消えるのでURLを付けない
function roomShareText(): string {
	const r = room.value;
	const title = r?.title ?? '';
	if (r != null && r.isEnded && !r.keepAfterEnd) return title;
	return title === '' ? roomUrl() : `${title}\n${roomUrl()}`;
}

async function postImage(area?: ImageArea | null): Promise<void> {
	const file = await os.promiseDialog(uploadImage(area));
	if (file == null) return;
	cancelSelecting();
	// JUICE: 注意書き(CW)のある部屋の絵は、同じ注意書きを付けて投稿する
	os.post({ initialFiles: [file], initialText: roomShareText(), ...(room.value?.cw != null ? { initialCw: room.value.cw } : {}) });
}

// JUICE: 部屋を共有する(部屋の名前とURLをノートに書く・URLをコピーする・端末の共有)
function openShareMenu(ev: MouseEvent): void {
	os.popupMenu([{
		text: i18n.ts.shareWithNote,
		icon: 'ti ti-pencil',
		action: () => os.post({ initialText: roomShareText(), ...(room.value?.cw != null ? { initialCw: room.value.cw } : {}) }),
	}, {
		text: i18n.ts.copyLink,
		icon: 'ti ti-link',
		action: () => copyToClipboard(roomUrl()),
	}, ...(typeof navigator.share === 'function' ? [{
		text: i18n.ts.share,
		icon: 'ti ti-share',
		action: () => {
			navigator.share({ title: room.value?.title ?? undefined, url: roomUrl() }).catch(() => {});
		},
	}] : [])], (ev.currentTarget ?? ev.target) as HTMLElement);
}

async function downloadImage(area?: ImageArea | null): Promise<void> {
	const image = await exportImage(area);
	if (image == null) return;
	const url = URL.createObjectURL(image.blob);
	const a = window.document.createElement('a');
	a.href = url;
	a.download = imageFileName(image.ext);
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	cancelSelecting();
}

function openImageMenu(ev: MouseEvent): void {
	os.popupMenu([{
		text: i18n.ts._drawRoom.saveImage,
		icon: 'ti ti-cloud-upload',
		action: () => saveImageToDrive(),
	}, {
		text: i18n.ts._drawRoom.postImage,
		icon: 'ti ti-pencil',
		action: () => postImage(),
	}, {
		text: i18n.ts._drawRoom.downloadImage,
		icon: 'ti ti-download',
		action: () => downloadImage(),
	}, { type: 'divider' }, {
		text: i18n.ts._drawRoom.selectArea,
		icon: 'ti ti-crop',
		action: startSelecting,
	}, { type: 'divider' }, {
		type: 'radio',
		text: i18n.ts._drawRoom.imageFormat,
		icon: 'ti ti-file-type-png',
		ref: imageFormat,
		options: imageFormatOptions.value,
	}], (ev.currentTarget ?? ev.target) as HTMLElement);
}

//#region 範囲の選択
// JUICE: 選んでいる間は、キャンバスをドラッグすると描かずに範囲を選ぶ(2本指・中ボタン・右ボタンでの移動はそのまま)
const selecting = ref(false);
const selection = ref<ImageArea | null>(null);
let selectFrom: { x: number; y: number; pointerId: number } | null = null;

function startSelecting(): void {
	selecting.value = true;
	selection.value = null;
	brushPanelOpen.value = false;
	mobilePanel.value = null;
}

function cancelSelecting(): void {
	selecting.value = false;
	selection.value = null;
	selectFrom = null;
}

function canvasPointInside(ev: PointerEvent): [number, number] {
	const e = engine.value!;
	const [x, y] = toCanvasPoint(ev);
	return [Math.min(e.width, Math.max(0, x)), Math.min(e.height, Math.max(0, y))];
}

function updateSelection(ev: PointerEvent): void {
	if (selectFrom == null) return;
	const [x, y] = canvasPointInside(ev);
	const left = Math.floor(Math.min(selectFrom.x, x));
	const top = Math.floor(Math.min(selectFrom.y, y));
	selection.value = {
		x: left,
		y: top,
		width: Math.ceil(Math.max(selectFrom.x, x)) - left,
		height: Math.ceil(Math.max(selectFrom.y, y)) - top,
	};
}
//#endregion
//#endregion

//#region チャット
// JUICE: チャットの入力欄で「:」から絵文字の候補を出す(入力欄が現れたときにつなぎ、消えたら外す)
watch(chatInputEl, (el, _old, onCleanup) => {
	if (el == null) return;
	const autocomplete = new Autocomplete(el, chatText, ['emoji']);
	onCleanup(() => autocomplete.detach());
});

// 絵文字の一覧から選んで、カーソルの位置に入れる
function insertChatEmoji(ev: MouseEvent): void {
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;
	let pos = chatInputEl.value?.selectionStart ?? chatText.value.length;
	let posEnd = chatInputEl.value?.selectionEnd ?? chatText.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			chatText.value = chatText.value.substring(0, pos) + emoji + chatText.value.substring(posEnd);
			pos += emoji.length;
			posEnd = pos;
		},
		() => {
			nextTick(() => chatInputEl.value?.focus());
		},
	);
}

function sendChat(): void {
	const text = chatText.value.trim();
	if (text.length === 0 || connection.value == null) return;
	connection.value.send('chat', { text });
	chatText.value = '';
}
//#endregion

const headerActions = computed(() => {
	const actions: { icon: string; text: string; handler: (ev: PointerEvent) => void }[] = [{
		icon: 'ti ti-arrows-minimize',
		text: i18n.ts._drawRoom.fitToScreen,
		handler: fitToScreen,
	}];
	// JUICE: 部屋の共有(保存しないで終了した部屋は、まもなく消えるので出さない)
	if (room.value != null && !(room.value.isEnded && !room.value.keepAfterEnd)) {
		actions.push({
			icon: 'ti ti-share',
			text: i18n.ts.share,
			handler: openShareMenu,
		});
	}
	if (isOwner.value && room.value != null && !room.value.isEnded) {
		actions.push({
			icon: 'ti ti-settings',
			text: i18n.ts._drawRoom.roomSettings,
			handler: openRoomSettings,
		}, {
			icon: 'ti ti-player-stop',
			text: i18n.ts._drawRoom.endRoom,
			handler: endRoom,
		});
	}
	// JUICE: 部屋主以外は部屋を通報できる。モデレーターは(開催中でも)部屋を削除できる
	if (!isOwner.value && room.value != null && !room.value.viewOnly) {
		actions.push({
			icon: 'ti ti-exclamation-circle',
			text: i18n.ts._drawRoom.reportRoom,
			handler: reportRoom,
		});
	}
	// 自分の部屋は、部屋主として(終了してから)削除する
	if (iAmModerator && !isOwner.value && room.value != null) {
		actions.push({
			icon: 'ti ti-trash',
			text: i18n.ts._drawRoom.deleteRoomAsModerator,
			handler: deleteRoomAsModerator,
		});
	}
	// JUICE: 狭いときは名前付きのメニューにまとめる
	return collapseHeaderActions(actions, isNarrow.value);
});

watch(() => props.roomId, () => {
	room.value = null;
	init();
});

// JUICE: ページはKeepAliveでキャッシュされ、別のページへ移ってもunmountされない。離れている間に
// Ctrl+Zで裏の部屋の線が消えたり、ストリームがつながりっぱなしになったりしないよう、
// 表示されている間だけリスナーとストリームを持ち、戻ってきたら読み込み直す
let listening = false;
let deactivated = false;
let pruneTimer: number | null = null;

function startListening(): void {
	if (listening) return;
	listening = true;
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('keyup', onKeyup);
	window.addEventListener('blur', onWindowBlur);
	window.document.addEventListener('visibilitychange', sendVisibility);
	window.addEventListener('pagehide', onPageHide);
	useStream().on('_disconnected_', onStreamDisconnected);
	useStream().on('_connected_', onStreamConnected);
	pruneTimer = window.setInterval(() => {
		engine.value?.pruneStalePending();
		const now = Date.now();
		for (const [userId, cursor] of cursors) {
			if (now - cursor.updatedAt > CURSOR_TIMEOUT_MS) cursors.delete(userId);
		}
	}, 2000);
}

function stopListening(): void {
	if (!listening) return;
	listening = false;
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('keyup', onKeyup);
	window.removeEventListener('blur', onWindowBlur);
	window.document.removeEventListener('visibilitychange', sendVisibility);
	window.removeEventListener('pagehide', onPageHide);
	cancelMinimapUpdate();
	useStream().off('_disconnected_', onStreamDisconnected);
	useStream().off('_connected_', onStreamConnected);
	if (pruneTimer != null) window.clearInterval(pruneTimer);
	pruneTimer = null;
}

function leavePage(): void {
	stopListening();
	cancelStroke();
	// 離れている間に指を離した知らせが届かないと、次に来たとき1本指のドラッグを2本指の操作と取り違えるので消しておく
	touches.clear();
	pinch = null;
	panFrom = null;
	selectFrom = null;
	selectGesture.value = null;
	fillGesture.value = null;
	if (moveDrag != null) finishMove(false);
	cancelRotateDrag();
	spaceHeld.value = false;
	// Misskeyの中で別のページへ移ったときも、すぐオフラインになるよう先に知らせる
	onPageHide();
	disposeRoom();
	// 読み込み途中だった場合も、その続きを捨てる
	initGeneration++;
}

onMounted(() => {
	startListening();
	init();
});

onActivated(() => {
	startListening();
	if (deactivated) {
		deactivated = false;
		init();
	}
});

onDeactivated(() => {
	deactivated = true;
	leavePage();
});

onUnmounted(() => {
	leavePage();
});

definePage(() => ({
	title: room.value?.title ?? i18n.ts._drawRoom.title,
	icon: 'ti ti-palette',
	// キャンバスを広く使えるよう、横のウィジェット欄を出さない
	needWideArea: true,
}));
</script>

<style lang="scss" module>
.frame {
	container-type: inline-size;
	container-name: drawRoom;
}

.root {
	position: relative;
	display: flex;
	gap: 12px;
	box-sizing: border-box;
	// ページ(デッキの列・ウインドウを含む)の表示領域いっぱいにする
	height: calc(100cqh - var(--MI-stickyTop, 0px) - var(--MI-stickyBottom, 0px));
	padding: 12px;

	// 狭いときはキャンバスを広く取り、レイヤー・チャットは下から出すパネルにする
	@container drawRoom (max-width: 800px) {
		position: relative;
		flex-direction: column;
		padding: 8px;
	}
}

.main {
	display: flex;
	flex: 1 1 0;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	min-height: 0;

	@container drawRoom (max-width: 800px) {
		position: relative;
	}
}

.status {
	position: relative;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.statusText {
	opacity: 0.8;
}

.statusButtons {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.tools {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;

	// JUICE: 狭い画面では名前付きのボタンを詰めて並べ、入りきらない分は折り返して全部見えるようにする
	// (横スクロールだと端のボタンが見切れて見え、スクロールできることにも気付きにくい)
	@container drawRoom (max-width: 800px) {
		flex: 1 1 auto;
		gap: 2px;
		min-width: 0;

		> .toolSeparator {
			display: none;
		}
	}
}

.brushButton {
	display: none;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	border-radius: 6px;

	@container drawRoom (max-width: 800px) {
		display: flex;
	}
}

.brushPreview {
	width: 18px;
	height: 18px;
	border-radius: 50%;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider);
}

// PCではツールバーにそのまま並べ、スマホでは押したときだけキャンバスの上に出す
.brushOptions {
	display: contents;

	@container drawRoom (max-width: 800px) {
		position: absolute;
		z-index: 10;
		top: 100%;
		left: 0;
		right: 0;
		display: none;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
		padding: 10px 12px;
		border-radius: var(--MI-radius);
		background: var(--MI_THEME-panel);
		box-shadow: 0 4px 16px var(--MI_THEME-shadow);

		> .toolSeparator {
			display: none;
		}
	}
}

.brushOptionsOpen {
	@container drawRoom (max-width: 800px) {
		display: flex;
	}
}

.statusEnd {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-left: auto;
}

.selectionBar {
	position: absolute;
	top: 8px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 4px;
	// left: 50%だと幅が表示領域の半分までに縮むので、中身の幅を取らせる(はみ出すときだけ折り返す)
	width: max-content;
	max-width: calc(100% - 16px);
	padding: 6px 8px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	box-shadow: 0 4px 16px var(--MI_THEME-shadow);
	font-size: 0.9em;
}

.selectionFormat {
	padding: 3px 6px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 6px;
	background: var(--MI_THEME-panel);
	color: inherit;
	font: inherit;
}

.selectionHint {
	padding: 0 6px;
	opacity: 0.8;
	font-variant-numeric: tabular-nums;
}

.selectionAction {
	padding: 4px 8px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.sheetButtons {
	display: none;
	gap: 4px;

	@container drawRoom (max-width: 800px) {
		display: flex;
	}

	> button {
		position: relative;
	}
}

.unreadDot {
	position: absolute;
	top: 4px;
	right: 4px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--MI_THEME-accent);
}

.toolButton {
	padding: 6px 8px;
	border-radius: 6px;
	font-size: 1.1em;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	// JUICE: 狭い画面(スマホ等)ではツールチップが出ないので、アイコンの下に短い名前を出す
	@container drawRoom (max-width: 800px) {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		gap: 1px;
		min-width: 44px;
		padding: 4px 4px 2px;
	}
}

.toolLabel {
	display: none;

	@container drawRoom (max-width: 800px) {
		display: block;
		font-size: 9px;
		line-height: 1.2;
		white-space: nowrap;
		opacity: 0.8;
	}
}

.toolButtonActive {
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
}

.toolSeparator {
	width: 1px;
	height: 20px;
	margin: 0 4px;
	background: var(--MI_THEME-divider);
}

.swatch {
	width: 20px;
	height: 20px;
	border-radius: 50%;
	border: solid 1px var(--MI_THEME-divider);
}

.swatchActive {
	outline: solid 2px var(--MI_THEME-accent);
	outline-offset: 1px;
}

.colorButton {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 2px 6px 2px 2px;
	border-radius: 999px;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider);
}

.colorButtonSwatch {
	width: 20px;
	height: 20px;
	border-radius: 50%;
	border: solid 1px var(--MI_THEME-divider);
}

.sizeLabel {
	display: flex;
	align-items: center;
	gap: 4px;

	@container drawRoom (max-width: 800px) {
		flex: 1 1 200px;

		> input {
			flex: 1;
			min-width: 0;
		}
	}
}

.sizeValue {
	min-width: 2em;
	font-variant-numeric: tabular-nums;
	opacity: 0.8;
}

.contentGate {
	position: absolute;
	inset: 0;
	z-index: 30;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: 16px;
	background: var(--MI_THEME-panel);
	text-align: center;
}

.contentGateIcon {
	font-size: 2em;
	opacity: 0.7;
}

.contentGateBadge {
	padding: 2px 8px;
	border-radius: 999px;
	background: var(--MI_THEME-warn);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 0.8em;
	font-weight: bold;
}

.contentGateCw {
	max-width: 480px;
	font-weight: bold;
	white-space: pre-wrap;
	word-break: break-word;
}

.contentGateText {
	opacity: 0.8;
}

.canvasLoading {
	position: absolute;
	inset: 0;
	z-index: 20;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.8);
	font-size: 0.9em;
}

.viewport {
	position: relative;
	flex: 1 1 0;
	min-height: 300px;
	overflow: hidden;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	// JUICE: 指やペンでのドラッグをブラウザのスクロール・拡大に使わせず、描画・移動に使う
	touch-action: none;
	user-select: none;

	@container drawRoom (max-width: 800px) {
		min-height: 0;
	}
}

.canvasStack {
	position: absolute;
	top: 0;
	left: 0;
	transform-origin: 0 0;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider), 0 4px 16px var(--MI_THEME-shadow);
}

.canvas {
	display: block;
}

// JUICE: ドットをくっきり表示(拡大しても画素をぼかさない)
.canvasStackPixelated canvas {
	image-rendering: pixelated;
}

// JUICE: キャンバスの拡大縮小はCSSのtransformなので、SVGの「拡大しても線の太さを変えない」指定(vector-effect)は効かない。
// 線の太さは、画面上の1pxにあたるキャンバス上の長さ(--px = 1 / 倍率)を掛けて指定する
.pixelGrid {
	fill: none;
	// キャンバス(紙)はテーマに関係なく白で、線は何色もあるので、どちらの上でも見える中間の灰色に固定する
	stroke: rgb(128, 128, 128);
	stroke-width: calc(var(--px) * 1px);
	shape-rendering: crispEdges;
}

.canvasOverlay {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.canvasDrawable {
	cursor: crosshair;
}

.canvasPicking {
	cursor: cell;
}

.canvasMove {
	cursor: move;
}

.canvasPan {
	cursor: grab;
}

// JUICE: なでるツール
.canvasPetting {
	cursor: pointer;
}

.rotateHandle {
	fill: var(--MI_THEME-panel);
	stroke: var(--MI_THEME-accent);
	stroke-width: calc(var(--px) * 2px);
	pointer-events: all;
	cursor: grab;
	touch-action: none;
}

.selectionOutline {
	fill: color-mix(in srgb, var(--MI_THEME-accent) 8%, transparent);
	stroke: var(--MI_THEME-accent);
	stroke-width: calc(var(--px) * 1.5px);
	stroke-dasharray: calc(var(--px) * 6px) calc(var(--px) * 4px);
}

.minimap {
	position: absolute;
	right: 8px;
	bottom: 8px;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
	// 全体マップの上では描かない(ドラッグは表示の移動に使う)
	touch-action: none;
}

.minimapBody {
	position: relative;
	overflow: hidden;
	border-radius: 6px;
	// キャンバス(白い紙)と同じ色にする
	background: #fff;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider), 0 2px 8px var(--MI_THEME-shadow);
	cursor: pointer;

	// スマホでは絵を隠しすぎないよう小さくする
	@container drawRoom (max-width: 500px) {
		zoom: 0.6;
	}
}

.minimapCanvasPixelated {
	image-rendering: pixelated;
}

.minimapToggleActive {
	color: var(--MI_THEME-accent);
}

.minimapCanvas {
	display: block;
	width: 100%;
	height: 100%;
}

.minimapFrame {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;

	> polygon {
		fill: color-mix(in srgb, var(--MI_THEME-accent) 12%, transparent);
		stroke: var(--MI_THEME-accent);
		stroke-width: 2px;
		vector-effect: non-scaling-stroke;
	}
}

.minimapBar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
}

.zoomSlider {
	flex: 1 1 60px;
	min-width: 40px;
}

.zoomLevel,
.minimapToggle {
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 0.8em;
	background: var(--MI_THEME-panel);
	box-shadow: 0 0 0 1px var(--MI_THEME-divider);
}

.zoomLevel {
	min-width: 3.5em;
	font-variant-numeric: tabular-nums;
}

// JUICE: 狭い画面(スマホ等)ではツールチップが出ないので、下のバーのアイコンの下にも小さく名前を出す
.minimapToggle,
.selectionAction {
	@container drawRoom (max-width: 800px) {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
	}
}

.minimapToggle {
	@container drawRoom (max-width: 800px) {
		padding: 3px 6px 2px;
		border-radius: 8px;
	}
}

.barLabel {
	display: none;

	@container drawRoom (max-width: 800px) {
		display: block;
		font-size: 9px;
		line-height: 1.2;
		white-space: nowrap;
		opacity: 0.8;
	}
}

.cursor {
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
	// まとめて届く間隔(0.1秒)に合わせて、次の位置までなめらかに動かす
	transition: transform 0.1s linear;
}

.debugInfo {
	position: absolute;
	top: 8px;
	left: 8px;
	z-index: 1;
	padding: 6px 8px;
	border-radius: 6px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 80%, transparent);
	color: var(--MI_THEME-fg);
	font-family: monospace;
	font-size: 11px;
	line-height: 1.5;
	pointer-events: none;
	white-space: nowrap;
}

.cursorHand {
	position: absolute;
	top: -12px;
	left: -10px;
	font-size: 22px;
	color: var(--MI_THEME-accent);
	filter: drop-shadow(0 0 2px var(--MI_THEME-bg));
	transform-origin: 50% 100%;
	animation: petWiggle 0.4s ease-in-out infinite alternate;
}

@keyframes petWiggle {
	from { transform: rotate(-15deg); }
	to { transform: rotate(15deg); }
}

.petHeart {
	position: absolute;
	top: -8px;
	left: -8px;
	font-size: 16px;
	color: var(--MI_THEME-love);
	pointer-events: none;
	filter: drop-shadow(0 0 2px var(--MI_THEME-bg));

	&::before {
		display: inline-block;
		animation: petHeartFloat 1.2s ease-out forwards;
	}
}

@keyframes petHeartFloat {
	from { transform: translate(0, 0) scale(0.6); opacity: 1; }
	to { transform: translate(var(--petHeartDrift), -40px) scale(1.1); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
	.cursorHand,
	.petHeart::before {
		animation: none;
	}
}

.cursorDot {
	position: absolute;
	top: -4px;
	left: -4px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--MI_THEME-accent);
	box-shadow: 0 0 0 2px var(--MI_THEME-bg);
}

.cursorAvatar {
	position: absolute;
	top: 6px;
	left: 6px;
	width: 26px;
	height: 26px;
	box-shadow: 0 0 0 2px var(--MI_THEME-accent);
}

.side {
	position: relative;
	display: flex;
	// JUICE: 幅は、見ている人が決めた幅で固定する(長い名前の人が来ても広がって、キャンバスが狭くならないように)
	flex: 0 0 var(--juiceSideWidth, 340px);
	flex-direction: column;
	width: var(--juiceSideWidth, 340px);
	min-width: 0;
	min-height: 0;

	// スマホでは下から出すパネル(開いているときだけ、選んだ方を表示)
	@container drawRoom (max-width: 800px) {
		width: auto;
		gap: 12px;
		position: absolute;
		z-index: 20;
		left: 8px;
		right: 8px;
		bottom: 8px;
		display: none;
		height: 55%;
		box-shadow: 0 -4px 24px var(--MI_THEME-shadow);
		border-radius: var(--MI-radius);
	}
}

.sideOpen {
	@container drawRoom (max-width: 800px) {
		display: flex;
	}
}

.sheetHidden {
	@container drawRoom (max-width: 800px) {
		display: none !important;
	}
}

.layers {
	// JUICE: 人が多くてもページの高さに収まるよう、決めた割合の高さにして、はみ出す分はこの中でスクロールする
	flex: 0 0 calc((100% - 12px) * var(--juiceLayersRatio, 0.55));
	min-height: 0;
	overflow-y: auto;

	@container drawRoom (max-width: 800px) {
		flex: 1 1 0;
	}
}

// JUICE: パネルの幅を変えるつまみ(パネルの左端)と、レイヤーとチャットの高さを変えるつまみ(間)
.sideResizer {
	position: absolute;
	top: 0;
	bottom: 0;
	left: -9px;
	z-index: 1;
	width: 6px;
	border-radius: 3px;
	cursor: col-resize;
	touch-action: none;

	&:hover,
	&:focus-visible {
		background: var(--MI_THEME-accent);
		opacity: 0.5;
	}

	@container drawRoom (max-width: 800px) {
		display: none;
	}
}

.splitResizer {
	flex: 0 0 12px;
	position: relative;
	cursor: row-resize;
	touch-action: none;

	&::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 50%;
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--MI_THEME-fg);
		opacity: 0.15;
		transform: translateX(-50%);
	}

	&:hover::after,
	&:focus-visible::after {
		background: var(--MI_THEME-accent);
		opacity: 0.8;
	}

	@container drawRoom (max-width: 800px) {
		display: none;
	}
}

.sheetClose {
	display: none;
	margin-left: auto;
	padding: 2px 6px;
	border-radius: 6px;

	@container drawRoom (max-width: 800px) {
		display: block;
	}
}

.sidePanel {
	box-sizing: border-box;
	min-width: 0;
	padding: 10px 12px;
}

// JUICE: 1人のレイヤー(上にあるものから)
.subLayers {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0 0 6px 34px;
}

.subLayer {
	display: flex;
	align-items: center;
	gap: 4px;
	min-height: 28px;
	padding: 0 4px;
	border-radius: 6px;
	font-size: 0.9em;
}

.subLayerActive {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.subLayerHidden .subLayerName {
	opacity: 0.5;
}

.subLayerName {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: left;
}

.subLayerOpacity,
.subLayerState {
	font-size: 0.85em;
	opacity: 0.7;
}

.layerOpacity {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 0.85em;

	> input {
		flex: 1;
		min-width: 0;
	}
}

.layerActions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

// 並べ替えのつまみ(タッチでもドラッグできるよう、スクロールに取られないようにする)
.layerGrip {
	padding: 4px 2px;
	border-radius: 6px;
	cursor: grab;
	opacity: 0.5;
	touch-action: none;

	&:hover {
		opacity: 1;
	}
}

.deleteAllLayers {
	color: var(--MI_THEME-error);
}

.addLayer {
	align-self: flex-start;
	padding: 4px 6px;
	border-radius: 6px;
	font-size: 0.85em;
	opacity: 0.8;

	&:hover {
		opacity: 1;
		background: var(--MI_THEME-buttonHoverBg);
	}
}

// JUICE: レイヤー・チャットをしまうボタン(PCだけ)と、しまったときに出すつまみ
.sideHideButton {
	margin-left: 6px;
	padding: 2px 6px;
	border-radius: 6px;
	font-weight: normal;
	opacity: 0.7;

	&:hover {
		opacity: 1;
		background: var(--MI_THEME-buttonHoverBg);
	}

	@container drawRoom (max-width: 800px) {
		display: none;
	}
}

.sideHandle {
	position: absolute;
	top: 50%;
	right: 0;
	z-index: 5;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	padding: 10px 6px;
	border-radius: 8px 0 0 8px;
	background: var(--MI_THEME-panel);
	box-shadow: 0 2px 8px var(--MI_THEME-shadow);
	transform: translateY(-50%);

	&:hover {
		color: var(--MI_THEME-accent);
	}

	@container drawRoom (max-width: 800px) {
		display: none;
	}
}

.sideHidden {
	@container drawRoom (min-width: 801px) {
		display: none;
	}
}

.sideHeader {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 8px;
	font-weight: bold;
}

.memberCount {
	margin-left: auto;
	font-weight: normal;
	font-size: 0.85em;
	opacity: 0.7;
}

.memberCount + .sheetClose {
	margin-left: 4px;
}

.layerRow {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	padding: 4px 0;
}

.layerAvatarWrap {
	position: relative;
	flex-shrink: 0;
	display: flex;
}

.layerAvatar {
	width: 26px;
	height: 26px;
}

.presenceDot {
	position: absolute;
	right: -2px;
	bottom: -2px;
	width: 10px;
	height: 10px;
	box-sizing: border-box;
	border-radius: 50%;
	border: solid 2px var(--MI_THEME-panel);
	background: var(--MI_THEME-fg);
	opacity: 0.4;
}

.presenceDotOnline {
	background: var(--MI_THEME-success);
	opacity: 1;
}

.layerRowOffline {
	opacity: 0.5;
}

.onlineSummary {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
	font-size: 0.85em;
	opacity: 0.8;
}

.onlineDotInline {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--MI_THEME-success);
}

.layerIdentity {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 4px;
	min-width: 0;
}

.layerName {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ownerIcon,
.drawingIcon {
	flex-shrink: 0;
	opacity: 0.7;
}

.layerButton {
	padding: 4px 6px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.layerSwitch {
	margin-top: 8px;
}

.chat {
	display: flex;
	flex: 1 1 0;
	flex-direction: column;
	min-height: 0;
}

.chatList {
	flex: 1 1 0;
	min-height: 0;
	overflow-y: auto;
}

.chatItem {
	display: flex;
	gap: 8px;
	padding: 4px 0;
}

.chatMenuButton {
	flex-shrink: 0;
	align-self: flex-start;
	margin-left: auto;
	padding: 2px 6px;
	border-radius: 6px;
	opacity: 0.5;

	&:hover,
	&:focus-visible {
		opacity: 1;
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.chatAvatar {
	flex-shrink: 0;
	width: 28px;
	height: 28px;
}

.chatBody {
	flex: 1 1 auto;
	min-width: 0;
}

.chatName {
	display: flex;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
	font-size: 0.8em;
	opacity: 0.7;

	> :first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}

.chatTime {
	flex-shrink: 0;
	font-size: 0.9em;
	opacity: 0.8;
}

.chatText {
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.chatForm {
	display: flex;
	gap: 6px;
	margin-top: 8px;
}

.chatInput {
	flex: 1;
	min-width: 0;
	padding: 6px 10px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 6px;
	background: var(--MI_THEME-panel);
	color: inherit;
	font: inherit;
}

.chatSend {
	padding: 6px 10px;
	border-radius: 6px;
	color: var(--MI_THEME-accent);

	&:disabled {
		opacity: 0.4;
	}
}
</style>
