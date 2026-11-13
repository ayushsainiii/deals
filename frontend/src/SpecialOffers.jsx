import {useState} from 'react';

const offers = [
  {category:'Design', name:'Canva Education', mark:'C', kind:'education', benefit:'Free for eligible schools',
    terms:'K–12 teachers can verify eligibility and invite their students.',
    url:'https://www.canva.com/help/about-canva-for-education/'},
  {category:'Streaming', name:'Airtel Xstream Play', mark:'▶', kind:'streaming', benefit:'Included with select recharges',
    terms:'Already on an eligible Airtel plan? Check the OTT access included.',
    url:'https://www.airtel.in/terms-conditions/prepaidvouchers'},
  {category:'AI tools', name:'GitHub Copilot Free', mark:'AI', kind:'coding', benefit:'Free plan',
    terms:'Includes 2,000 code completions per month. No credit card required.',
    url:'https://github.com/features/copilot/plans'},
  {category:'Streaming', name:'Prime Video Free to Me', mark:'PV', kind:'streaming', benefit:'Free with ads',
    terms:'Watch select content in India without a Prime membership.',
    url:'https://www.aboutamazon.in/news/company-news/prime-video-mx-player-india-largest-streaming-service'},
  {category:'Student perks', name:'GitHub Student Developer Pack', mark:'GH', kind:'coding', benefit:'Free for verified students',
    terms:'Developer tools and partner perks. Each benefit has its own limits.',
    url:'https://education.github.com/pack'},
  {category:'Student perks', name:'JetBrains Student Pack', mark:'JB', kind:'coding', benefit:'Free educational license',
    terms:'For verified eligible students. Educational and non-commercial use.',
    url:'https://www.jetbrains.com/academy/student-pack/'},
  {category:'Design', name:'Figma Starter', mark:'F', kind:'education', benefit:'Free plan',
    terms:'Design and brainstorm with limits on shared files and features.',
    url:'https://www.figma.com/pricing/'},
  {category:'Design', name:'Adobe Express Free', mark:'Ae', kind:'education', benefit:'Free plan',
    terms:'Basic photo and video editing. No credit card required.',
    url:'https://www.adobe.com/express/pricing'},
  {category:'Learning', name:'Microsoft Learn', mark:'ML', kind:'coding', benefit:'Free training',
    terms:'Self-paced courses on cloud, AI and developer tools. Certification exams may cost extra.',
    url:'https://learn.microsoft.com/en-us/training/support/learn-content-types'},
];

export function SpecialOffers() {
  const [expanded,setExpanded] = useState(false);
  return <section className="special-offers" aria-labelledby="special-offers-heading">
    <div className="special-offers-heading">
      <h2 id="special-offers-heading">Special offers</h2>
      <p>Free plans and perks you might already qualify for.</p>
    </div>
    <div className="special-offers-grid" id="special-offers-list">
      {(expanded ? offers : offers.slice(0,3)).map(({category,name,mark,kind,benefit,terms,url}) =>
        <a key={name} className="special-offer" href={url} target="_blank" rel="noopener noreferrer"
          aria-label={name+' eligibility and terms (opens in a new tab)'}>
          <span className={'special-offer-mark '+kind} aria-hidden="true">{mark}</span>
          <span className="special-offer-copy">
            <small>{category}</small><strong>{name}</strong>
            <span className="special-offer-benefit">{benefit}</span>
            <span className="special-offer-terms">{terms}</span>
          </span>
          <span className="special-offer-arrow" aria-hidden="true">↗</span>
        </a>)}
    </div>
    <button type="button" className="secondary" style={{marginTop:12}} aria-expanded={expanded}
      aria-controls="special-offers-list" onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show fewer offers' : 'View all '+offers.length+' offers'}
    </button>
  </section>;
}
