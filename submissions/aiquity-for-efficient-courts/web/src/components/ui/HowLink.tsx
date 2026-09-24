import Link from "next/link";

/** One-line pointer to the full rule on How it works. */
export default function HowLink({ id, label, className }: { id: string; label: string; className?: string }) {
  return (
    <Link href={`/how#${id}`} className={`text-[12px] text-primary hover:underline ${className ?? ""}`}>
      See How it works → {label}
    </Link>
  );
}
