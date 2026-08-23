import { useEffect, useMemo, useState } from "react";
import { adminQuestions, questionCategories, type AdminQuestion } from "../data/adminQuestions";

type Answers = Record<number, number>;

const STORAGE_KEY = "kolbe-admin-brief-v2";

const questionsByCategory = new Map(
  questionCategories.map((category) => [
    category.id,
    adminQuestions.filter((question) => question.category === category.id),
  ]),
);

function loadAnswers(): Answers {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved) as { answers?: Answers };
    return parsed.answers ?? {};
  } catch {
    return {};
  }
}

function faNumber(value: number) {
  return value.toLocaleString("fa-IR");
}

export default function AdminBrief() {
  const [answers, setAnswers] = useState<Answers>(loadAnswers);
  const [currentId, setCurrentId] = useState(1);
  const [showMap, setShowMap] = useState(false);

  const currentIndex = adminQuestions.findIndex((question) => question.id === currentId);
  const currentQuestion = adminQuestions[currentIndex];
  const answeredCount = adminQuestions.reduce(
    (count, question) => count + (answers[question.id] !== undefined ? 1 : 0),
    0,
  );
  const progress = Math.round((answeredCount / adminQuestions.length) * 100);
  const selectedAnswer = answers[currentId];

  const categoryStats = useMemo(
    () => questionCategories.map((category) => {
      const questions = questionsByCategory.get(category.id) ?? [];
      const answered = questions.filter((question) => answers[question.id] !== undefined).length;
      return { ...category, total: questions.length, answered, firstId: questions[0]?.id ?? 1 };
    }),
    [answers],
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, answers, updatedAt: new Date().toISOString() }));
  }, [answers]);

  const selectAnswer = (optionIndex: number) => {
    setAnswers((current) => ({ ...current, [currentId]: optionIndex }));
  };

  const goToQuestion = (id: number) => {
    setCurrentId(id);
    setShowMap(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goNext = () => {
    if (currentIndex < adminQuestions.length - 1) goToQuestion(adminQuestions[currentIndex + 1].id);
  };

  const goPrevious = () => {
    if (currentIndex > 0) goToQuestion(adminQuestions[currentIndex - 1].id);
  };

  const goToNextUnanswered = () => {
    const afterCurrent = adminQuestions.slice(currentIndex + 1).find((question) => answers[question.id] === undefined);
    const fromStart = adminQuestions.find((question) => answers[question.id] === undefined);
    const target = afterCurrent ?? fromStart;
    if (target) goToQuestion(target.id);
  };

  const downloadAnswers = () => {
    const payload = {
      project: "پنل مدیریت کلبه وینتیج",
      completed: answeredCount,
      total: adminQuestions.length,
      exportedAt: new Date().toISOString(),
      answers: adminQuestions.map((question) => ({
        id: question.id,
        category: questionCategories.find((category) => category.id === question.category)?.label,
        question: question.title,
        selectedOption: answers[question.id] === undefined ? null : answers[question.id] + 1,
        answer: answers[question.id] === undefined ? null : question.options[answers[question.id]],
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kolbe-admin-brief.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const resetAnswers = () => {
    if (!window.confirm("همه پاسخ‌های ثبت‌شده پاک شوند؟")) return;
    setAnswers({});
    setCurrentId(1);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const currentCategory = questionCategories.find((category) => category.id === currentQuestion.category);
  const currentCategoryQuestions = questionsByCategory.get(currentQuestion.category) ?? [];

  return (
    <div dir="rtl" className="mx-auto max-w-[1500px] pb-12">
      <section className="overflow-hidden rounded-[3px] bg-[#011c3a] text-white">
        <div className="grid gap-8 px-5 py-7 lg:grid-cols-[1fr_auto] lg:items-end lg:px-8 lg:py-9">
          <div>
            <div className="flex items-center gap-2 text-[10.5px] text-white/60">
              <span>نیازسنجی محصول</span>
              <span className="h-px w-8 bg-[#df6247]" />
              <span>نسخه تصمیم‌گیری</span>
            </div>
            <h1 className="mt-4 max-w-2xl text-[26px] font-medium leading-tight sm:text-[34px]">ممیزی جامع کلبه وینتیج</h1>
            <p className="mt-3 max-w-xl text-[12.5px] leading-6 text-white/65">هزار پرسش در ۲۰ حوزه؛ پاسخ‌ها خودکار ذخیره می‌شوند و مبنای تصمیم‌گیری محصول، طراحی، فنی، عملیات و کسب‌وکار خواهند بود.</p>
          </div>
          <div className="flex items-end gap-3">
            <strong className="text-[48px] font-medium leading-none text-[#df6247] num-fa">{faNumber(progress)}٪</strong>
            <span className="pb-1 text-[11px] leading-5 text-white/55"><b className="block text-[14px] font-medium text-white num-fa">{faNumber(answeredCount)} از {faNumber(adminQuestions.length)}</b>پاسخ ثبت شده</span>
          </div>
        </div>
        <div className="h-1 bg-white/10"><div className="h-full bg-[#df6247] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="hidden max-h-[calc(100vh-96px)] self-start overflow-y-auto rounded-[3px] border border-neutral-200 bg-white p-3 xl:sticky xl:top-[76px] xl:block">
          <div className="flex items-center justify-between px-2 pb-3">
            <h2 className="text-[12px] font-medium">حوزه‌های تصمیم‌گیری</h2>
            <span className="text-[10px] text-neutral-400">{faNumber(questionCategories.length)} حوزه</span>
          </div>
          <nav className="space-y-1" aria-label="دسته‌بندی پرسش‌ها">
            {categoryStats.map((category) => {
              const active = category.id === currentQuestion.category;
              const complete = category.answered === category.total;
              return (
                <button key={category.id} type="button" onClick={() => goToQuestion(category.firstId)} className={`flex w-full items-center gap-3 rounded-[3px] px-2.5 py-2.5 text-right transition ${active ? "bg-[#011c3a] text-white" : "hover:bg-[#f3f4f4]"}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center border text-[10px] num-fa ${active ? "border-white/25" : complete ? "border-[#3d5c3a] bg-[#eef4ee] text-[#3d5c3a]" : "border-neutral-200 text-neutral-500"}`}>{complete ? "✓" : faNumber(category.answered)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{category.label}</span>
                  <span className={`text-[9.5px] num-fa ${active ? "text-white/50" : "text-neutral-400"}`}>{faNumber(category.total)}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <button type="button" onClick={downloadAnswers} disabled={answeredCount === 0} className="h-9 w-full rounded-[3px] bg-[#011c3a] text-[11px] font-medium text-white transition hover:bg-[#0a2c55] disabled:cursor-not-allowed disabled:opacity-35">دانلود پاسخ‌ها</button>
            <button type="button" onClick={resetAnswers} disabled={answeredCount === 0} className="mt-2 h-8 w-full text-[10.5px] text-neutral-400 transition hover:text-[#9e4b3c] disabled:hidden">پاک‌کردن پاسخ‌ها</button>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 xl:hidden">
            <button type="button" onClick={() => setShowMap((open) => !open)} className="h-9 rounded-[3px] border border-neutral-300 bg-white px-4 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2">{showMap ? "بستن نقشه" : `نقشه ${faNumber(currentCategoryQuestions.length)} سؤال این حوزه`}</button>
            <button type="button" onClick={downloadAnswers} disabled={answeredCount === 0} className="h-9 rounded-[3px] bg-[#011c3a] px-4 text-[11.5px] text-white disabled:opacity-35">دانلود پاسخ‌ها</button>
          </div>

          {showMap ? (
            <div className="mb-5 rounded-[3px] border border-neutral-200 bg-white p-4 xl:hidden">
              <QuestionMap questions={currentCategoryQuestions} answers={answers} currentId={currentId} onSelect={goToQuestion} />
            </div>
          ) : null}

          <section className="rounded-[3px] border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="bg-[#eef1f3] px-2.5 py-1 text-[10.5px] text-[#53616e]">{currentCategory?.label}</span>
                  {selectedAnswer !== undefined ? <span className="bg-[#eef4ee] px-2.5 py-1 text-[10.5px] text-[#3d5c3a]">پاسخ داده شده</span> : <span className="bg-[#f7f4ea] px-2.5 py-1 text-[10.5px] text-[#7a6320]">در انتظار پاسخ</span>}
                </div>
                <span className="text-[11px] text-neutral-400 num-fa">سؤال {faNumber(currentQuestion.id)} از {faNumber(adminQuestions.length)}</span>
              </div>
            </div>

            <div className="px-5 py-7 sm:px-7 sm:py-9">
              <h2 className="max-w-3xl text-[22px] font-medium leading-[1.7] sm:text-[28px]">{currentQuestion.title}</h2>
              <div className="mt-7 grid gap-2.5 md:grid-cols-2" role="radiogroup" aria-label={currentQuestion.title}>
                {currentQuestion.options.map((option, optionIndex) => {
                  const selected = selectedAnswer === optionIndex;
                  return (
                    <button key={option} type="button" role="radio" aria-checked={selected} onClick={() => selectAnswer(optionIndex)} className={`group flex min-h-[72px] items-center gap-4 rounded-[3px] border px-4 py-3 text-right transition ${selected ? "border-[#011c3a] bg-[#011c3a] text-white shadow-[0_8px_22px_rgba(1,28,58,0.12)]" : "border-neutral-200 bg-white hover:border-[#83909c] hover:bg-[#fafafa]"}`}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center border text-[11px] font-medium ${selected ? "border-[#df6247] bg-[#df6247] text-white" : "border-neutral-300 text-neutral-500 group-hover:border-[#011c3a]"}`}>{faNumber(optionIndex + 1)}</span>
                      <span className="text-[13px] leading-6">{option}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-5 py-4 sm:px-7">
              <button type="button" onClick={goPrevious} disabled={currentIndex === 0} className="h-9 rounded-[3px] border border-neutral-300 px-4 text-[11.5px] transition hover:border-[#011c3a] disabled:cursor-not-allowed disabled:opacity-30">سؤال قبلی</button>
              <button type="button" onClick={goNext} disabled={currentIndex === adminQuestions.length - 1} className="h-9 rounded-[3px] bg-[#011c3a] px-5 text-[11.5px] font-medium text-white transition hover:bg-[#0a2c55] disabled:cursor-not-allowed disabled:opacity-30">سؤال بعدی</button>
              {answeredCount < adminQuestions.length ? <button type="button" onClick={goToNextUnanswered} className="mr-auto h-9 text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-4 hover:text-[#011c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2">رفتن به پاسخ‌داده‌نشده بعدی</button> : <span className="mr-auto text-[11.5px] font-medium text-[#3d5c3a]">همه {faNumber(adminQuestions.length)} سؤال تکمیل شد</span>}
            </div>
          </section>

          <div className="mt-5 hidden rounded-[3px] border border-neutral-200 bg-white p-5 xl:block">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-[12px] font-medium">نقشه پرسش‌ها</h2><span className="text-[10px] text-neutral-400">برای رفتن مستقیم، شماره را انتخاب کنید</span></div>
            <QuestionMap questions={currentCategoryQuestions} answers={answers} currentId={currentId} onSelect={goToQuestion} />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionMap({ questions, answers, currentId, onSelect }: { questions: AdminQuestion[]; answers: Answers; currentId: number; onSelect: (id: number) => void }) {
  return (
    <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-[repeat(20,minmax(0,1fr))]">
      {questions.map((question) => {
        const answered = answers[question.id] !== undefined;
        const active = currentId === question.id;
        return <button key={question.id} type="button" onClick={() => onSelect(question.id)} aria-label={`سؤال ${faNumber(question.id)}${answered ? "، پاسخ داده شده" : ""}`} className={`aspect-square min-h-6 rounded-[2px] text-[8px] transition sm:text-[9px] ${active ? "bg-[#df6247] text-white ring-2 ring-[#df6247]/25 ring-offset-1" : answered ? "bg-[#011c3a] text-white" : "border border-neutral-200 bg-[#f7f7f6] text-neutral-400 hover:border-[#011c3a]"}`}>{faNumber(question.id)}</button>;
      })}
    </div>
  );
}
