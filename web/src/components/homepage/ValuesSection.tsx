import { VALUES } from "./values";

export default function ValuesSection() {
  return (
    <section id="values" className="home-section home-container" aria-labelledby="why-tembo">
      <h2 id="why-tembo" className="home-heading home-commitments-heading">What stays true.</h2>
      <ul className="home-commitments">
        {VALUES.map((value) => (
          <li key={value.word} className="value-commitment-row">
            <h3 className="value-word font-heading">{value.word}</h3>
            <p className="value-commitment-copy">{value.commitment}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
