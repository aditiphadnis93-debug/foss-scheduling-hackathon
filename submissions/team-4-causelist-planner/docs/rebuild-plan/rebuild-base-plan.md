Data is described on /home/sk/dev/pucar-hackathon/docs/updated-provided-docs/data/README.md.

Build a simplified web app htat helps a judge create a causelist. This should only this data set and none of synthetic generated data. Show this new as a new tab in the judges view.

The cause list creation process:
- A cause list is created at 7 PM that lists the cases that will be heard the - next day.
- The next day(hearing day) the judge goes through each case that is presented and changes/retains the status of it.

there are two asks:
- A schedule/causelist forecasting model: Given a roster create a causelist for the next 60 days by using optimal scheduling.
- The judge should be presented with a decision support system where he can move cases to future dates. The future dates possible are based on `Time to next hearing given this is the purpose (days)` in the `hearing_typre_reference`.
    - Keep the system simple. Show the judge the nearest possible date and recommend the nearest possible date based on slots available. 
    - Judge can propose the new date.
    - If there are sufficient hours available on the new date, mention to judge.
    - If there aren't sufficient hours, the existing draft causelist would have to be updated to move cases around.
    - Show the impact of the proposed date.
    - In addition to judge proposing a new date, the system should also run the forecasting model and see when it best fits.

- The decision support system should show all relevant data for the judge to make a decision.