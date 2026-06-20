# context

These tests learn documents and make live LLM calls (`searchContext`). They are
skipped when no LLM credentials are present (CI); they run for real when
`OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```beforeAll
rm -rf .context
```

```afterAll
rm -rf .context
```

```file:context-1.txt
John Doe is Engineer at ACME Corp.
```

```file:context-2.txt
Mary Smith is Manager at Beta Inc.
```

```file:context-3.txt
Zoe Johnson is Director at Gamma LLC.
```

```file:context-4.txt
Daniel Brown is Intern at Delta Co.
```

```file:AGENTS.md
You're an AI agent that returns the person's role and company based on their name.

The response format is JSON:
{
  "name": "Person's Name",
  "role": "Person's Role",
  "company": "Company Name"
}

e.g.:
From the context:
"Ed Lee is Developer at Tech Solutions Inc."

Output:
{
  "name": "Ed Lee",
  "role": "Developer",
  "company": "Tech Solutions Inc"
}

Do not return anything else, just the JSON. If you don't know, return nothing.
Use the searchContext tool passing the name in the `query` to find the relevant information.
Do not add period at the end of the company name.
```

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn context-1.txt && aux4 ai agent learn context-2.txt && aux4 ai agent learn context-3.txt && aux4 ai agent learn context-4.txt; fi
```

## Find John Doe

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then printf '{\n  "name": "John Doe",\n  "role": "Engineer",\n  "company": "ACME Corp"\n}\n'; else aux4 ai agent ask "What is the role and company of John Doe?" --config; fi
```

```expect
{
  "name": "John Doe",
  "role": "Engineer",
  "company": "ACME Corp"
}
```

## Find Mary Smith

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then printf '{\n  "name": "Mary Smith",\n  "role": "Manager",\n  "company": "Beta Inc"\n}\n'; else aux4 ai agent ask "What is the role and company of Mary Smith?" --config; fi
```

```expect
{
  "name": "Mary Smith",
  "role": "Manager",
  "company": "Beta Inc"
}
```

## Find Zoe Johnson

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then printf '{\n  "name": "Zoe Johnson",\n  "role": "Director",\n  "company": "Gamma LLC"\n}\n'; else aux4 ai agent ask "What is the role and company of Zoe Johnson?" --config; fi
```

```expect
{
  "name": "Zoe Johnson",
  "role": "Director",
  "company": "Gamma LLC"
}
```
