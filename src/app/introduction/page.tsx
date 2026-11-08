'use client';

import { LecturerCard } from '@/components/lecturer';
import { PageHeading } from '@/components/ui';

/** Who teaches: the lecturer of the courses, for every signed-in user. */
export default function Introduction() {
  return (
    <>
      <PageHeading title="Giới thiệu" description="Chủ giảng của các khóa học." />
      <LecturerCard />
    </>
  );
}
