import { redirect } from 'next/navigation';

/** The console has one entry point today: the call list (PLAN.md row A1). */
export default function Home() {
  redirect('/calls');
}
