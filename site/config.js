/* Wedding details. Edit this file, then upload the site folder again.
   Anything left as "" keeps the [placeholder] text in the app. */
window.CFG = {
  // From Supabase: Project Settings > API Keys > Legacy API keys (use the "anon public" key)
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Honeymoon fund (leave one blank to hide that button)
  venmo: '',   // Venmo username, like 'Mackenzie-Meyers'
  cashapp: '', // Cash App $Cashtag, like '$MackenzieM'

  // Text that fills in the [brackets] across the app
  text: {
    '[Wedding Date]': '',          // 'Saturday, May 15, 2027'
    '[Time]': '',                  // '4:00 PM'
    '[Venue]': '',                 // 'Rocking R Ranch'
    '[City]': '',                  // 'Magnolia'
    '[RSVP Date]': '',             // 'April 1'
    '[Destination]': '',           // 'Cabo'
    '[Anniversary Date]': '',      // 'May 15, 2028'
    '[Venue name and address]': '',
    '[Dress code]': '',            // 'Western formal'
    '[Their story in a few sentences]': '',
    '[Where and how Brandon asked]': '',
    '[Something guests would love to know]': ''
  },

  // The day, in order. "start" is the real date and time (keep the -05:00 for Texas in summer, -06:00 in winter).
  moments: [
    { name: 'The Ceremony', start: '2099-01-01T16:00:00-06:00', time: '4:00 PM', img: 'images/hero.jpg', pos: '50% 40%', tip: 'Phones down for the vows. Snap away after the kiss!', mission: 'Catch the first kiss as husband and wife' },
    { name: 'Cocktail Hour', start: '2099-01-01T16:45:00-06:00', time: '4:45 PM', img: 'images/denim.jpg', pos: '50% 40%', tip: 'Grab a drink and say hey to someone new.', mission: 'Take a selfie with a guest you just met' },
    { name: 'The Reception', start: '2099-01-01T18:00:00-06:00', time: '6:00 PM', img: 'images/kiss.jpg', pos: '50% 30%', tip: 'Tacos, toasts and the first dance.', mission: 'Get the first dance on video' },
    { name: 'The Send-Off', start: '2099-01-01T22:00:00-06:00', time: '10:00 PM', img: 'images/ring.jpg', pos: '50% 60%', tip: 'Line up outside to send them off in style.', mission: 'Film the grand exit' }
  ],

  // Scavenger hunt missions: [moment, mission]
  hunt: [
    ['Ceremony', 'The first kiss as husband and wife'],
    ['Ceremony', 'Someone happy crying'],
    ['Cocktail Hour', 'A selfie with a guest you just met'],
    ['Cocktail Hour', 'The best pair of boots here'],
    ['Reception', 'The first dance'],
    ['Reception', 'Grandparents on the dance floor'],
    ['Reception', 'The best taco plate'],
    ['Send-Off', 'The grand exit']
  ],

  // Couple quiz. "correct" is the number of the right answer, counting from 0.
  quiz: [
    { q: 'Who said "I love you" first?', o: ['Mackenzie', 'Brandon', 'Same time', 'Still arguing about it'], correct: 0 },
    { q: 'Who takes longer to get ready?', o: ['Mackenzie', 'Brandon', 'A tie', 'Depends on the boots'], correct: 0 }
  ],

  // Wedding party (leave empty to keep the placeholders)
  party: {
    her: [], // [{ name: 'Sara', role: 'Maid of Honor' }]
    his: []  // [{ name: 'Tyler', role: 'Best Man' }]
  }
};
