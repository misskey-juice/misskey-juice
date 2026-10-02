/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent, reactive, watch } from 'vue';
import { throttle } from 'throttle-debounce';
import type { Reactive } from 'vue';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { getDefaultFormValues } from '@/utility/form.js';
import * as os from '@/os.js';
import { deepClone } from '@/utility/clone.js';
import type { WidgetName } from './index.js';

export type Widget<P extends Record<string, unknown>> = {
	id: string;
	data: Partial<P>;
};

export type WidgetComponentProps<P extends Record<string, unknown>> = {
	widget?: Widget<P>;
};

export type WidgetComponentEmits<P extends Record<string, unknown>> = {
	(ev: 'updateProps', props: P): void;
};

export type WidgetComponentExpose = {
	name: string;
	id: string | null;
	configure: () => void;
};

export const useWidgetPropsManager = <F extends FormWithDefault>(
	name: WidgetName,
	propsDef: F,
	props: Readonly<WidgetComponentProps<GetFormResultType<F>>>,
	emit: WidgetComponentEmits<GetFormResultType<F>>,
): {
	widgetProps: Reactive<GetFormResultType<F>>;
	save: () => void;
	configure: () => void;
} => {
	const widgetProps = reactive((() => {
		const np = getDefaultFormValues(propsDef);
		if (props.widget?.data != null) {
			for (const key of Object.keys(props.widget.data) as (keyof F)[]) {
				np[key] = props.widget.data[key] as GetFormResultType<F>[typeof key];
			}
		}
		return np;
	})());

	// JUICE: このウィジェットが送った設定(の中身)。設定が保存されて戻ってきたときに、その後に変えた値を
	// 古い値で上書きしないよう、自分が送った設定は読み直さない(すばやく続けて変えると、元に戻ってしまうため)
	const emittedSnapshots = new Set<string>();
	// 設定の中身を、キーの順番によらない文字列にする
	const snapshotOf = (data: Record<string, unknown>) => JSON.stringify(Object.keys(propsDef).map(key => data[key] ?? null));

	watch(() => props.widget?.data, (to) => {
		if (to != null) {
			if (emittedSnapshots.has(snapshotOf(to))) return;
			for (const key of Object.keys(propsDef)) {
				(widgetProps as any)[key] = to[key];
			}
		}
	}, { deep: true });

	const save = throttle(3000, () => {
		const snapshot = snapshotOf(widgetProps as Record<string, unknown>);
		emittedSnapshots.add(snapshot);
		// 覚えておくのは最近のものだけにする
		if (emittedSnapshots.size > 20) emittedSnapshots.delete(emittedSnapshots.values().next().value!);
		emit('updateProps', widgetProps as GetFormResultType<F>);
	});

	const configure = async () => {
		const form = deepClone(propsDef);
		for (const item of Object.keys(form)) {
			form[item].default = (widgetProps as any)[item];
		}

		const res = await new Promise<{
			canceled: false;
			result: GetFormResultType<F>;
		} | {
			canceled: true;
		}>((resolve) => {
			const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkWidgetSettingsDialog.vue')), {
				widgetName: name,
				form: form,
				currentSettings: widgetProps,
			}, {
				saved: (newProps) => {
					resolve({ canceled: false, result: newProps as GetFormResultType<F> });
				},
				canceled: () => {
					resolve({ canceled: true });
				},
				closed: () => {
					dispose();
				},
			});
		});

		if (res.canceled) {
			return;
		}

		for (const key of Object.keys(res.result)) {
			(widgetProps as any)[key] = res.result[key];
		}

		save();
	};

	return {
		widgetProps,
		save,
		configure,
	};
};
