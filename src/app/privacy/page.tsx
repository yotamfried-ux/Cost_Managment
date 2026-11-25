import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "מדיניות פרטיות | D2R Management",
  alternates: { canonical: "https://finance.d2ryf.com/privacy" },
};

export default function PrivacyPolicy() {
  return <main className="auth-shell"><article className="panel auth-card privacy-card">
    <Brand />
    <h1>מדיניות הפרטיות של D2R Management</h1>
    <p>D2R Management היא סביבת עבודה פרטית לניהול הוצאות, חיובי ספקים ומסמכים פיננסיים.</p>
    <section>
      <h2>גישה ל־Gmail</h2>
      <p>מנהל סביבת העבודה יכול לאשר גישה לקריאה בלבד באמצעות Google OAuth. הסנכרון מחפש בתווית החשבוניות שהוגדרה הודעות מהתקופה האחרונה משולחים שאושרו מראש. כשנמצא מסמך מתאים, המערכת מייבאת את קובץ ה־PDF או את הודעת הקבלה המקורית, ושומרת פרטים הדרושים להצגתה ולמניעת כפילויות, כגון השולח, הנושא, התאריך ומזהה ההודעה.</p>
      <p>המידע מ־Gmail משמש לאיסוף מסמכי מקור ולהתאמתם לחיובים בסביבת העבודה. האפליקציה אינה שולחת, משנה או מוחקת הודעות. היא אינה מוכרת מידע מ־Google או משתמשת בו לפרסום או לאימון מודלי AI.</p>
    </section>
    <section>
      <h2>אחסון וגישה</h2>
      <p>Vercel מארחת את האפליקציה ומאחסנת את פרטי החיבור ל־Google כמשתני שרת מוגנים. המסמכים ונתוני החשבונות נשמרים בהצפנה במאגר פרטי ב־GitHub. הגישה למסמכים באפליקציה מוגבלת למשתמשי סביבת העבודה לפי הרשאותיהם.</p>
      <p lang="en" dir="ltr">D2R Management’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
    </section>
    <section>
      <h2>ניתוק, שמירה ומחיקה</h2>
      <p>אפשר לבטל את החיבור בכל עת דרך <a href="https://myaccount.google.com/connections">החיבורים בחשבון Google</a>. הביטול עוצר יבוא עתידי. מסמכים שכבר יובאו נשמרים בסביבת העבודה לצורכי תיעוד. לבקשת גישה, תיקון או מחיקה יש לפנות למנהל סביבת העבודה. גרסאות קודמות של מסמכים עשויות להישאר מוצפנות בהיסטוריית האחסון.</p>
    </section>
    <Link href="/sign-in">כניסה ל־D2R Management</Link>
  </article></main>;
}
