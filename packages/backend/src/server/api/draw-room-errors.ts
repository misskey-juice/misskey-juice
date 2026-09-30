/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { DrawRoomError } from '@/core/DrawRoomService.js';
import { ApiError } from '@/server/api/error.js';

/**
 * JUICE: 絵チャ(draw-rooms/*)のAPIで共通に使うエラー。各エンドポイントのmeta.errorsに、
 * 実際に起こりうるものだけを選んで入れる
 */
export const drawRoomErrors = {
	disabled: {
		message: 'Drawing chat is disabled on this server.',
		code: 'DRAW_ROOM_DISABLED',
		id: '91008f45-4ffe-458c-bee3-4f972b96c09b',
	},
	noSuchRoom: {
		message: 'No such room.',
		code: 'NO_SUCH_ROOM',
		id: '23cdd1a0-ce31-41a0-9a27-ebd5ef333773',
	},
	forbidden: {
		message: 'You cannot see this room.',
		code: 'FORBIDDEN',
		id: '3ac4ce60-fd2a-4d19-8902-923202ba338f',
	},
	ended: {
		message: 'This room has already ended.',
		code: 'ROOM_ENDED',
		id: '33024eb4-ff48-4f5e-b083-9e1c893ecedb',
	},
	full: {
		message: 'This room is full.',
		code: 'ROOM_FULL',
		id: '80512214-91b6-40c3-b5ba-fb2d0d43d505',
	},
	alreadyHosting: {
		message: 'You are already hosting the maximum number of rooms.',
		code: 'ALREADY_HOSTING',
		id: '1c5ff310-dfa1-40a9-93a9-650bdbb9ee79',
	},
	notOwner: {
		message: 'Only the owner of the room can do this.',
		code: 'NOT_OWNER',
		id: '055522b8-89d0-42e2-8e70-9b60d017e87f',
	},
	notMember: {
		message: 'The user is not a member of this room.',
		code: 'NOT_MEMBER',
		id: '8d123178-c0d1-4527-8460-ccdeeca43d52',
	},
	kicked: {
		message: 'You were removed from this room by the owner and cannot join again.',
		code: 'KICKED',
		id: '4591aa2b-28d2-4073-8b89-61ab90df10cf',
	},
	notEnded: {
		message: 'The room has not ended yet.',
		code: 'ROOM_NOT_ENDED',
		id: 'ade63663-3dcc-46c8-a3b7-85951300f295',
	},
	cannotKickOwner: {
		message: 'The owner cannot be removed from the room.',
		code: 'CANNOT_KICK_OWNER',
		id: '9d925a15-0697-471b-b86a-74592123b991',
	},
	invalidCanvasSize: {
		message: 'Specify both canvasWidth and canvasHeight, or neither.',
		code: 'INVALID_CANVAS_SIZE',
		id: '9892ae72-5cc9-41f6-958f-64a9f220cb39',
	},
	cannotCreate: {
		message: 'Your role does not allow you to create drawing chat rooms.',
		code: 'CANNOT_CREATE_DRAW_ROOM',
		id: '2e833178-f934-42a8-af76-c79624e64ca8',
	},
	canvasTooLarge: {
		message: 'The canvas size exceeds the limit allowed by your role.',
		code: 'CANVAS_TOO_LARGE',
		id: '6a818472-9d68-4b26-9d38-a7129f3fdd34',
	},
} as const;

/**
 * DrawRoomServiceが投げたDrawRoomErrorを、対応するApiErrorに置き換えて投げ直す
 */
export function rethrowDrawRoomError(err: unknown): never {
	if (err instanceof DrawRoomError) throw new ApiError(drawRoomErrors[err.reason]);
	throw err;
}
