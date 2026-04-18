import type { ReactNode } from "react";

interface TableProps {
  headers: string[];
  children: ReactNode;
}

export default function Table({ headers, children }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-teal/20">
      <table className="w-full text-left text-sm">
        <thead className="bg-teal/30 text-xs uppercase text-white/80">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-teal/10">{children}</tbody>
      </table>
    </div>
  );
}
