/**
 * The class timetable of study and practice ("Bảng phân lịch học tập và thực hành"). Every item is a
 * tick box a group leader ticks for each member and each lesson; the score is the share ticked.
 * Ids are stored, so keep them stable and only append new ones.
 */
export interface PracticeItem {
  id: string;
  label: string;
}
export interface PracticeGroup {
  id: string;
  title: string;
  items: PracticeItem[];
}

export const PRACTICE_GROUPS: PracticeGroup[] = [
  {
    id: 'study',
    title: 'Nhiệm vụ học tập',
    items: [
      {
        id: 'study-listen',
        label: 'Nghe pháp từ thứ Hai đến thứ Sáu hằng tuần theo chương trình học của lớp.',
      },
      {
        id: 'study-reflect',
        label:
          'Sau khi nghe pháp, chủ động suy ngẫm, ghi chép những điều tâm đắc và liên hệ với bản thân.',
      },
      {
        id: 'study-report',
        label:
          'Hoàn thành bài báo cáo tâm đắc, cảm ngộ hằng tuần bằng hình thức PowerPoint, video và viết vở theo quy định.',
      },
      {
        id: 'study-submit',
        label: 'Gửi bài báo cáo lên website chung của nhóm trước 22h00 tối thứ Bảy hằng tuần.',
      },
    ],
  },
  {
    id: 'daily',
    title: 'Thực hành đạo lý — Nhiệm vụ hằng ngày',
    items: [
      { id: 'daily-write', label: 'Viết 2 câu kinh văn theo nội dung học tập của lớp.' },
      {
        id: 'daily-tidy',
        label:
          'Thực hành sắp xếp, giữ gìn sự ngăn nắp, sạch sẽ đối với bàn học, giường ngủ hoặc tủ quần áo.',
      },
      { id: 'daily-photo', label: 'Chụp ảnh kết quả thực hành và gửi lên nhóm theo quy định.' },
    ],
  },
  {
    id: 'weekly',
    title: 'Thực hành đạo lý — Nhiệm vụ hằng tuần',
    items: [
      {
        id: 'weekly-deed',
        label:
          'Chủ động thực hiện ít nhất một việc làm thiết thực để thể hiện lòng hiếu thảo, tinh thần phụng sự gia đình: nấu một bữa cơm cuối tuần cho gia đình, hoặc tổng vệ sinh nhà cửa (cọ rửa nhà vệ sinh, hút bụi, lau nhà…).',
      },
      {
        id: 'weekly-photo',
        label: 'Chụp ảnh ghi nhận kết quả thực hành và gửi lên nhóm theo quy định.',
      },
    ],
  },
  {
    id: 'spirit',
    title: 'Tinh thần thực hành',
    items: [
      { id: 'spirit-sincere', label: 'Thực hành bằng tâm tự giác, chân thành và trách nhiệm.' },
      {
        id: 'spirit-meaning',
        label:
          'Không làm qua loa, đối phó; không chỉ hoàn thành nhiệm vụ mà cần hiểu ý nghĩa của từng việc làm.',
      },
      {
        id: 'spirit-improve',
        label:
          'Lấy việc sửa đổi bản thân, hiếu kính cha mẹ, yêu thương gia đình và giúp đỡ mọi người làm mục tiêu thực hành.',
      },
      {
        id: 'spirit-persist',
        label:
          'Kiên trì thực hiện mỗi ngày, từng bước hình thành những thói quen tốt và chuyển hóa bản thân.',
      },
    ],
  },
];

export const PRACTICE_ITEM_IDS = new Set(PRACTICE_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
export const PRACTICE_TOTAL = PRACTICE_ITEM_IDS.size;

/** Ticked items that still exist in the timetable, and the resulting score. */
export function practiceScore(items: string[] | undefined) {
  const done = new Set((items ?? []).filter((id) => PRACTICE_ITEM_IDS.has(id))).size;
  return { done, total: PRACTICE_TOTAL, percent: Math.round((done / PRACTICE_TOTAL) * 100) };
}
