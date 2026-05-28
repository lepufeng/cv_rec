# ATS Field Review

Last researched: 2026-05-22  
Last schema alignment: 2026-05-27

This note summarizes common fields seen in mainstream job application platforms and ATS products, then maps them to the current `ResumeData` schema. The current full schema reference lives in `SCHEMA.md`.

## Sources Reviewed

- Greenhouse Job Board API: required `first_name`, `last_name`, `email`; supports phone, resume, cover letter, education, employment, and job-specific questions. https://developer.greenhouse.io/job-board.html
- Lever Application Form: full name and email required by default; supports phone, preferred location, link questions such as LinkedIn/GitHub, file uploads for resume or cover letter. https://help.lever.co/hc/en-us/articles/20087243347741-Configuring-your-Lever-Application-Form
- Ashby Application Forms: supports phone, email, resume, candidate location, file upload, education history, custom questions, and field connectors to candidate profile fields. https://docs.ashbyhq.com/application-forms
- Indeed Apply Application Data: applicant name/email/phone/resume/cover letter, structured resume fields for skills, positions, education, languages, links, awards, certifications, associations, patents, publications, licenses, assessments, relocation status, and custom sections. https://docs.indeed.com/indeed-apply/application-data
- LinkedIn Apply Connect: contact, resume, cover letter, work experience, education, voluntary self-identification, and additional custom questions. https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-required-fields
- Workable Application Form: personal information, profile, details, custom fields, education, and experience; expected salary/right-to-work examples appear as custom fields. https://help.workable.com/hc/en-us/articles/115012236908-How-can-I-change-reorder-application-form-fields
- Oracle Taleo candidate fields: personal information, availability, preferences, schedule/travel, expected pay, education, experience, questionnaires, skills, source tracking, and certifications. https://docs.oracle.com/en/cloud/saas/taleo-enterprise/otrcg/c-advancedcandidatesearchfields.html
- SAP SuccessFactors candidate profile/application: resume parsing into candidate profile fields, country/region, phone/SMS opt-in, cover letter, required questions, resume, cover letter, education, certificates, work experience. https://help.sap.com/docs/successfactors-recruiting/recruiting-in-sap-successfactors-test-script/9b6624101ff745aa9f17a4c52478f76a.html
- Handshake Quick Apply: student/campus flows commonly depend on profile preferences and required documents, often resume. https://support.joinhandshake.com/hc/en-us/articles/360013861394-Jobs-Quick-Apply-in-Handshake

## Common Field Families

### Core Identity And Contact

Common fields:
- Full name, first name, last name, middle name
- Email
- Phone/mobile phone
- Current location
- Address line, city, state/province, country, postal code
- Preferred/legal name in some forms

Current coverage:
- Covered: `basic_info.name`, `phone`, `email`, `location`, `hometown`
- Gaps: split name fields, address object, country/state/postal code, legal/preferred name

Recommended schema additions:
- `basic_info.name_parts`: `{ first_name, middle_name, last_name, preferred_name, legal_name }`
- `basic_info.address`: `{ country, region, city, postal_code, address_line1, address_line2 }`

### Documents And Links

Common fields:
- Resume/CV upload
- Cover letter file or text
- Additional attachments
- LinkedIn, GitHub, portfolio, personal website

Current coverage:
- Resume file is stored outside `ResumeData`
- Links can only survive through `extra_sections`

Recommended schema additions:
- `links`: list of `{ label, url, type }`
- `documents`: metadata for resume, cover letter, transcript, portfolio, other attachments

### Education

Common fields:
- School/institution
- Degree or education level
- Field of study/program/major
- Start/end dates or graduation date
- GPA
- City/location
- Graduation status
- Custom education fields

Current coverage:
- Covered: `school`, `degree`, `major`, `start_date`, `end_date`, `gpa`, `honors`, `courses`, `ranking`
- Gaps: education location, graduation date/status, transcript/degree document, normalized GPA scale

Recommended schema additions:
- `education[].location`
- `education[].graduation_date`
- `education[].graduated`
- `education[].gpa_normalized`: optional structured object
- Keep `education[].ranking` as added in schema version `1.2`
- Use top-level `facts` from schema version `1.3` for long-tail education facts before promoting them into fixed fields; schema version `1.4` also adds `skills.tools` and `work_experience[].department`; schema version `1.5` promotes high-frequency student campus experience into `campus_experience[]`; schema version `1.6` promotes student internships into `internship_experience[]`

### Internship / Work Experience

Common fields:
- Company/employer
- Title
- Start/end dates
- Current job flag
- City/location
- Description, accomplishments, responsibilities
- Job function/category

Current coverage:
- Covered: `internship_experience[]` for explicit internships, `work_experience[]` for non-internship jobs; both include `company`, `department`, `title`, `start_date`, `end_date`, `achievements`, `tech_stack`
- Gaps: location, current flag, job function/category, employment type

Recommended schema additions:
- `work_experience[].location`
- `work_experience[].current`
- `work_experience[].job_function`
- `work_experience[].employment_type`

### Skills, Certifications, Languages

Common fields:
- Skills list and taxonomy categories
- Certifications/licenses, issuer, ID, issue date, expiration date
- Languages and proficiency

Current coverage:
- Covered: `skills`, `certifications`, `languages`
- Gaps: certification/license ID, expiration date, credential URL, skill proficiency

Recommended schema additions:
- `skills.*[]` could evolve from string to `{ name, category, proficiency, evidence }` later
- `certifications[]`: add `credential_id`, `issue_date`, `expiration_date`, `url`
- Add separate `licenses[]` if license fields become frequent

### Job Preferences And Eligibility

Common fields:
- Available date / notice period
- Preferred location
- Expected salary/pay
- Work authorization / eligibility
- Sponsorship requirement
- Relocation willingness
- Travel, schedule, shifts, weekends/holidays

Current coverage:
- Covered: `job_intent.target_position`, `expected_salary`, `available_date`, `work_location_preference`
- Gaps: authorization, sponsorship, relocation, notice period, travel/schedule preferences

Recommended schema additions:
- `job_intent.notice_period`
- `job_intent.work_authorization`
- `job_intent.requires_sponsorship`
- `job_intent.relocation_willingness`
- `job_intent.travel_preference`
- `job_intent.schedule_preference`

### Screening And Custom Questions

Common fields:
- Yes/no questions
- Multiple choice questions
- Numeric/date/text custom questions
- Work authorization, salary expectations, specific qualifications
- Candidate source/referral

Current coverage:
- Stage B can answer from resume data, but Stage A has no reusable screening-answer store

Recommended schema additions:
- `facts`: list of `{ label, key, value, source_text, confidence }` now exists at top level; use it for reusable screening facts
- `referral`: `{ referred, referrer_name, source }`

### Compliance And Sensitive Data

Common fields:
- Voluntary self-identification: gender, race/ethnicity, disability, veteran status
- Date of birth or national ID in some jurisdictions

Current coverage:
- Some fields exist in `basic_info`, but not separated by sensitivity/consent

Recommendation:
- Do not auto-fill sensitive compliance fields by default.
- If supported, place them under a separate `sensitive_profile` object with explicit user consent and field-level warnings.

## Schema Priority Recommendations

P0:
- `education[].ranking` - completed in `schema_version=1.2`
- `facts` dynamic reusable fact layer - completed in `schema_version=1.3`
- `skills.tools` and `work_experience[].department` - completed in `schema_version=1.4`
- `campus_experience[]` for student organizations, clubs, volunteer service, and campus roles - completed in `schema_version=1.5`
- `internship_experience[]` for fresh-graduate internship history - completed in `schema_version=1.6`
- `links`
- `basic_info.address`
- `job_intent.work_authorization`
- `job_intent.requires_sponsorship`
- `job_intent.relocation_willingness`

P1:
- `work_experience[].location`, `current`, `job_function`, `employment_type`
- `education[].location`, `graduation_date`, `graduated`
- richer `certifications[]` fields
- Expand `facts` with user-confirmed answers from Stage B

P2:
- `documents`
- `licenses`
- `publications`
- `patents`
- `associations`
- `references`
- consent-gated `sensitive_profile`
