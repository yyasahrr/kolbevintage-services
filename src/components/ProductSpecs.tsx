import { specs } from "../dataSpecs";

export default function ProductSpecs() {
  return (
    <div>
      <h3 className="mb-5 text-[18px] font-medium">Product specifications</h3>
      <div className="overflow-hidden rounded-[6px] border border-neutral-200">
        <table className="w-full text-[12.5px]">
          <tbody>
            {specs.map((s, index) => (
              <tr
                key={s.label}
                className={
                  "grid grid-cols-[42%_58%] gap-x-4 px-4 py-3 lg:grid-cols-[38%_62%] " +
                  (index % 2 === 0 ? "bg-white" : "bg-[#f7f6f3]")
                }
              >
                <th className="text-left font-medium text-neutral-500">{s.label}</th>
                <td className="text-[#011c3a]">{s.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
