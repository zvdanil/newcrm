import fetch from 'node-fetch'

async function run() {
  const staffId = 'c2203f81-5cb4-4d3d-b529-3a96f0a6996f' // From user
  const body = {
    activity_id: undefined,
    rate_category: 'auto',
    rate_type: 'hourly',
    value_mode: 'fixed',
    rate_value: 200,
    deduction_pct: 0,
    valid_from: '2026-05-01'
  }
  
  console.log('Sending request...')
  const res = await fetch(`http://localhost:3000/api/staff/${staffId}/rates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer 1' // Mock or whatever token is needed, if the server checks it. Wait, I can't easily mock auth if it checks JWT.
    },
    body: JSON.stringify(body)
  })
  
  console.log(res.status)
  console.log(await res.text())
}

run()
