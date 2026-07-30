import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// افتراضي 20 ثانية: أي صفحة يتم فتحها تاني خلال 20 ثانية تستخدم البيانات المخزنة
			// بدل ما تعمل طلب جديد للسيرفر. الاستعلامات اللي محددة staleTime خاص بيها
			// (زي الداشبورد وتحديثه كل دقيقة) بتفضل شغالة زي ما هي.
			staleTime: 20000,
		},
	},
});