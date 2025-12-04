import Head from 'next/head'
import StudentTimetable from '../components/StudentTimetable'
import { Analytics } from "@vercel/analytics/next"

export default function Home() {
  return (
    <>
      <Head>
        <title>FAST Timetable — For Your Ease Use</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Beautiful real-time student timetable with instant search powered by Google Sheets" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <StudentTimetable />
      <Analytics />
    </>
  )
}