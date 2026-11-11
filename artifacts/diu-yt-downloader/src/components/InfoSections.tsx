import { Plus } from "lucide-react";
import { PLATFORM_META, type Platform } from "@/lib/platforms";

export function HowItWorks({ platform }: { platform?: Platform }) {
  const steps = [
    {
      title: "Copy the link",
      body: platform
        ? PLATFORM_META[platform].findLink
        : "In the app, tap Share, then Copy link. On a computer, copy the address bar.",
    },
    {
      title: "Paste it here",
      body: "Seba recognises the site and lists every quality the video is available in.",
    },
    {
      title: "Pick a quality and download",
      body: "The file goes to your downloads folder as MP4, or M4A when you choose audio only.",
    },
  ];

  return (
    <section aria-labelledby="how" className="mt-24">
      <h2 id="how" className="text-3xl font-bold sm:text-4xl">
        How it works
      </h2>
      <ol className="mt-8 grid gap-8 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="border-t-2 border-ink pt-4">
            <span className="font-display text-5xl leading-none font-bold text-brand" aria-hidden>
              {i + 1}
            </span>
            <h3 className="mt-3 text-xl font-bold">{s.title}</h3>
            <p className="mt-2 max-w-[38ch] text-ink-soft">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Is it free?",
    a: "Yes. There's no account to create, no download limit and no ads.",
  },
  {
    q: "Why didn't my link work?",
    a: "Private and age-restricted videos, Facebook posts shared only with friends or groups, and posts from private Instagram accounts can't be saved. Photo posts and TikTok slideshows have no video in them.",
  },
  {
    q: "Which qualities can I get?",
    a: "Whatever the original upload has. YouTube goes up to 4K, Facebook usually offers HD and SD, and Instagram serves one quality. TikTok can be saved with or without the watermark.",
  },
  {
    q: "Why does a download take a while to start?",
    a: "For HD and higher, YouTube and Facebook keep the picture and the sound in separate files. Seba joins them before your download begins, so longer videos take longer.",
  },
  {
    q: "Can I save audio only?",
    a: "Yes, for YouTube, Facebook and TikTok. Choose Audio only in the quality list.",
  },
  {
    q: "Am I allowed to download any video?",
    a: "Only save videos you have the right to keep, such as your own uploads or videos whose creators allow it. Don't re-upload other people's work as your own.",
  },
];

export function Questions() {
  return (
    <section aria-labelledby="faq" className="mt-24 max-w-3xl">
      <h2 id="faq" className="text-3xl font-bold sm:text-4xl">
        Questions
      </h2>
      <div className="mt-6 border-b border-line">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="group border-t border-line">
            <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-4 text-lg font-bold">
              {item.q}
              <Plus className="size-5 shrink-0 transition-transform group-open:rotate-45" aria-hidden />
            </summary>
            <p className="max-w-[65ch] pb-5 text-ink-soft">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
