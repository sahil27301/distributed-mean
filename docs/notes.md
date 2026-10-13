# Notes — raw dump

Running log of questions, thoughts, and half-decisions. Anything that turns out to matter graduates to `decisions/`.

---

## Context

- Wherever there are any ambiguities or stuff open to interpretation, make a reasonable decision and document it.
- Important stuff: completeness, design and decisions, understanding of the algorithm, tradeoffs, etc.. Bonus is skippable.
- Inspiration: n departments, each with data on its own server; train one model on the combined data without data leaving the server. Brute force = one server at a time. Multiple companies possible. Federated Learning.

---

## Log

### Q: Why split work by F (files) and not by C (indices)?

- The mean at index i needs all F files, so splitting by C doesn't get around the 5-file limit.
- Example, if we want the avg at index x, we would have to load all F files to get that, but we can load at most 5 files.

### Q: Should we care about file generation at scale?

- No. Data is assumed to already exist at rest (matches the inspiration). Pick whatever is simplest. We're aggregating data, not generating data.

### Q: Run at max F and C?

- Not feasible locally (~10^11 numbers). Design for max, run at moderate sizes.

### Q: What does "≤5 files at a time" mean — per task, or in memory at once?

- Assuming per task. Problem statement says a task takes ≤ 5 files, and to figure out how to split the job when f > 5. If it was a memory limit, we could load 5 at a time inside a single worker, which defeats the point.
- Besides, processing these 5 at a time in a single worker is also slow, and doesn't utilise other workers to speed this up.

### Q: Do we know which workers are slow beforehand? Or are some files randomly slower, regardless of worker?

- TBD

### Parallels and Differences compared to the Inspiration

#### Inspiration

Links

- [Federated Learning Intro](https://flower.ai/docs/framework/tutorial-series-what-is-federated-learning.html)
- [Asynchronous Federated Learning](https://ai.meta.com/blog/asynchronous-federated-learning/)
- [Decentralised Federated Learning](https://scalablebook.icsgen-ai.org/part-3-distributed-ml/module-14-federated-decentralized-learning/section-14.8.html)

The inspiration is federated learning. Here, a model needs to be trained on data which can't leave certain nodes.  
So, we send the model to the nodes, there is local learning, and the updated model (or just the new weight deltas) are sent back to the central server, where these are 'aggregated'.  
Then, the updated model is sent out to client nodes, and the process repeates. This way, the model is trained on data across all nodes, without data ever leaving the nodes.  
Each client's update is weighted according to it's data size.  
Another concern is security. 2 concepts:

- Secure Aggregation - be able to aggregate without letting to central server see the individual values of any node.
- Differential Privacy - prevent leaking of info like personal details from any node, usually by adding some statistical noise.

Another concept - asynchronous federated learning  
Usually, the central server sends out the model to all clients, waits for responses from all, aggregates.  
Problem: You are bound by the slowest node. Need to wait for it to return before you can aggregate.  
Asynchronous Solution: Clients request the model whenever they are ready. Train it and send it back when done. The central server doesn't wait for all clients before aggregating, aggregates as and when it gets updates.  
Some updates may land on a staler version, so reduce their weightage.

Another concept - decentralised federated learning  
No central server. Nodes are connected in a ring or graph to other nodes, and repeatedly share weights with only their neighbours.  
This is called gossip, and eventually every node reaches the average.  
No single point of failure.  
Issues: Can be extremely slow, especially for sparse graphs.

#### Parallels and Differences

- Where we had N different clients, we now have F different files. Each file has some data, and the server wants the aggregation across these files.

**Interpretation 1**

- Can we think of the C values in each file as the raw model updates for a single client? And we need to aggregate them.
- The central server is powered by W workers here, responsible for aggregating these updates.
- The resulting file we want to create is the aggregated update across all clients.

**Interpretation 2**

- The workers are doing the clients' work (i.e. local model training). However, where one client only processes data on that server, one worker can instead process data from multiple 'clients'.
- This mixes a few concepts though, because the task the workers are doing is closer to aggregation.

Interpretation 1 feels more intuitive, so that's what we will be following. We begin work once all weight updates have been sent to the central server.  
Other constraints mapped:

- Memory: Each worker cannot load weights from all clients into memory, and here, each worker can read at most 5 files.
- Speed: Some workers may be slow. We need to decide if these workers are predetermined, depend on the files they're aggregating, or completely random.

Other comparisons:

- FL has multiple rounds, we have only 1. If we were to update clients again, that would be equivalent to receiving a new job from these clients, with F files.
- FL weighs on the basis of size of the client. While all files in a job are the same size here, we will have partial sums, so we should weight them accordingly. Instead of processing just (values), we are processing (values, length) at each step.
- Async FL - The biggest difference is that we have all client updates at once. Staleness isn't an issue, because we don't have model versions to apply it to. However, we still have the concept of 'partial updates', since we can merge at most 5 files at a time, so we'll have to combine these iteratively. This is the biggest takeaway from here.
- Decentralised FL - Doesn't apply. This would be equivalent to all F servers (files) talking to each other, and eventually coming to the average over multiple rounds.
- Security is out of scope. Secure aggregation works on sum of masked vectors, so our design could still support it in the future.
- Several jobs ~= several companies

### Q: Why do we want to look at >5 value for F?

- If the request has ≤5 files, a single worker can load all F files in memory and produce the answer. Simplest case.

### Slow workers: What are they, how do we deal with them?

Few ways of interpreting this

- Workers themselves are slow
- Tasks are slow - depending on the size of the files
- Random - Simulating stuff like GC pauses, network spikes, busy neighbours

The problem statement says `Assume that workers process files at different speeds.`. So, some per worker factor (+jitter) should be considered. The jitter somewhat factors in random slowness as well.

And tasks being slow for files with larger C values (more concretely, F\*C) also makes sense intuitively.

Also, the system shouldn't know which servers are slow (may or may not learn it later).

If we have pull based queues, slowness mostly doesn't matter because each worker will pull enough work according to it's speed, automatically.  
Where the slow worker may still bite:

- Close to the final step - almost all merges are completed, but the fast workers are idle because they need a result from the slow worker for the final merge. Faster workers could potentially duplicate the task if they're idle.
- If there are less than W steps left, we would ideally want to route it to the faster workers. But with a pull based system, there's no central routing step, so this isn't possible.

These are optimisations we can consider later. A pull based queue already gives us an elegant, simple way to deal with slowness for the most part.

### How do you represent a job in the queue?

#### **Assuming a single job**

My first instinct is put all F files in the queue as F items, and let workers pull up to 5 files from the queue (assume standard queue processing, error handling, returning to the queue on failure, etc.).  
Then, after 5 files are merged, the worker inserts a new partial sum in the queue as a new item. There is no real difference between a single file and a partial sum file. Each will have a vector of size C, and some field indicating the length of the files considered for this sum. The F items will intially set this to 1.  
Each file should also have the total number of files in the job as another field. The worker can simply check, after the merge, if the resulting length == F, process it as an answer and don't reinsert this into the queue.

This works because merge is associative (any grouping) and commutative (any order). Floating point operations are not strictly associative though, but the error is tiny (1e-16), and ignored for this application. Or use ints for the random numbers.

Few constraints:

- Making sure we don't double count: deleting 5 items from the queue and inserting the new one should be atomic. Use transactions.
- Most queues are atleast once. So, we should make outputs idempotent. For example, make the partial's id deterministic. Then, repeated merge produces the same id, and we dedupe. Might be tricky with dynamic grouping - if first queue pulls items 1-5, takes long, and next one pulls items 3-7, and then both insert results.
- A worker only picks up items if there are ≥ 2 items. If only 1, it means the other partials are still being processed. Needs an explicit decision though - less items = more merges but less idle time. We can later replace polling with something like LISTEN/NOTIFY.
- Queue items are references, not the files themselves. File could be stored anywhere.
- Backup copies - not considered for now

If we're using pg backed queues + commits, the transaction prevents double counting, which makes idempotent outputs unnecessary.  
Consider this situation

- Worker claims items 1-5. Lease is 15 mins.
- Worker takes 20 mins.
- After 15 mins, worker 2 picks up items 3-7.
  Now, there are 2 results with overlap, and we cannot simply combine these 2.

One options is to throw away the results if they took >15m (lease time). Not optimal, because we waste a valid result if nothing else had picked up overlapping items after lease expiry. Also, race condition - lease could expire between check and commit. Possible clock drift between db and worker.

Fix for this - whenever a worker is done, it must 'consume' the inputs and insert the result in one single transaction. If it cannot find all inputs, another worker consumed something, so rollback. So each item in the queue is consumed exactly once. Outputs don't need to be idempotent this way.  
We don't need ownership checks in the commit this way. In case of multiple workers processing something, whichever one finishes first wins, and the other one rolls back.  
For the final merge, the result is written, and inputs are consumed atomically.  
Each attempt writes to its own path, so no overwriting can take place.

Potential optimisation, not considered for v1: Worker computes new file, writes file to storage, but crashes before committing the new item and deleting the older ones. This leaves the orphaned file in storage. Potentially GC orphaned files.

### Lease duration

One option is configuring something like 15 mins, but that's slower to detect crashes. An alternative is to use 30s lease, and the worker renews is every 10s. This way something that genuinely needs longer can continue working without someone else reclaiming its items prematurely.

## Multi job handling

So far, we've only talked about one job, and how we would split and process it. But a critical requirement is supporting multiple jobs.  
The first, obvious change is to maintain the job id on the files/partials, and allow a worker to pull files only belonging to the same job. We need to figure out how to pick these.  
Naive flow, considering one shared queue:

- We receive a job, enqueue F1 files.
- Receive another job, enqueue F2 files.
- A worker pulls the first available file it can. Looks at the job id. Pulls up to 4 more files from that id.
- After it's done, partial goes at the back of the queue, behind F2's files.
- Workers continue this way, and the flow can roughly become process F1 files, then F2 files, then the merges of F1, then the merges of F2, etc.

This way, we process in a fifo order, and each new 'level' goes to the back of the queue.

Problems with this:

- The way the queue pulls items is very awkward. Pull 1 and then the rest. Can also lead to race conditions where 2 workers both pull 1, find no other item for this job, and put them at the back of the queue.
- Even if something is now one merge away from the answer, it will go to the back of the queue.
- New jobs will be blocked waiting for a huge job before them.

What we want:

- Drawing a parallel from multi jobs to multi companies, we wouldn't want to make one company wait for another. This points to a round robin queue.
- We would need to somehow maintain a list of active jobs, and the next job for a worker to pick. If it knows the job id, no need to 'pick 1 and then the rest'.
- Other options:
  - Shortest job first/Least remaining time - large jobs get stuck behind smaller jobs that keep on coming
  - Priority based - we could potentially mark some companies (jobs) as more important, and guarantee they finish first. Not a requirement for now.
  - Multi level queues - each queue with it's own priority and scheduling algorithm. Not really helpful for us.

For a round robin queue, we would need to maintain a list of active jobs, and keep rotating the list after each claim.
Implication: after the second last merge, the final merge will still be queued behind one merge of every other job. This waits for (active jobs ÷ W workers) tasks, which is relatively small.

How do workers claim jobs this way? We need something like a semaphor to claim jobs? The worker gets the semaphore, claims 5 items from the job at the start of the list, rotates the list, releases semaphore.  
If the worker crashes before releasing semaphore? Short semaphore hold ttl.  
What if the worker is just slow, so cannot release the semaphore in time, but still picks up a particular job id to process? The next worker sees the same id, and tries picking from the same job. The first worker would have a lease on these items, so the second worker doesn't claim them (even if it does, the single consumption constraint guarantees single result). If there are more items to process for this job id, the second worker picks them. Otherwise, it rotates the queue and picks the next item (and rotates it again).

Simpler approach - in pg itself, we can simply maintain last_claimed_at for every job, and each worker, atomically, finds the job that has waited the longest and has ≥2 claimable items, then claims upto 5 of its items. Counting claimable items could be slow. Intead of counting each time, we could maintain a count of claimable items per job in a later version. This would create a hot row though, and we would need to make sure the value here is always correct.

Note: round robin picks every job equally, but jobs with larger C will take longer and hence take up more processing time per cycle. Acceptable tradeoff for v1.

How we can make picking these jobs for rr fast:

- Create a partial index on jobs where status=running, with (last_claimed_at, created_at). This way, when looking for new jobs, we only see the ones in running status, not the entire table.
- Then, limit the per job check to at most 2 items. Regardless of whether an job has 2 items of 20k to claim, we can claim it. So no need to scan all items, just 2. Now, if other workers have claimed some items ((W-1) \* 5 across all W workers), we will have to scan at most (((W-1) \* 5) + 2), which stays small.
- How many potential jobs can we scan through? Let's say the job we scan has all items already under another worker's lease. We cannot pick more items from here, so move on to the next job. Totally, the other W-1 workers can be processing at most W-1 jobs, and assume each task here uses up all the itmes from that job. So we will scan at most W jobs.
- In the worst case, we will scan and reject at most ((W-1) \* 5) items which are already leased. And we read at most 1 claimable row from (W-1) workers and 2 claimable rows from the last worker, so the total is (((W-1) \* 5) + W-1 + 2) ~= (6 \* W - 4) items.
- How we can find these items per job id quickly - create an index on the items on (job_id, count desc). This let's you instantly find all matching items for this job, starting with the biggest partial first.
- Note: we cannot make this index tighter by creating it on status=unclaimed as well. Reason: We also look at stuff in status=claimed if the lease has expired. We would need something like lease has expired before NOW(), which is not supported in an index's where clause.

### Why process the bigger partials first when picking candidates to merge for a job

There is no difference in the number of merge steps required, or the number of workers waiting idle towards the end.  
The issue is space. Whenever a worker works, it produces a single partial file. So these always increase by +1 each time. However, if any of the workers inputs were partial files, those are deleted from storage after the merge commits. No reason to store partials once they're used.  
If we prioritise files, the entire next layer of partials is kept in store till we process all individual files. If we prioritise partials, we prioritise consuming and deleting these intermediate files, so they number of partial files never grows beyond W. (Roughly) Every partial is consumed in a round, and the round produces W partials.  
Now, if a certain worker is slower: If it grabs the largest partial, the other workers will then work with the remaining files and partials, so total files may rise a little, but still proportional to W. The slow worker can hold up at most 5 partials, so totally 5W partials extra across workers.

### Failure Mode: Poisoned file

If a certain file, for any reason, is corrupted, it crashes every worker that tries to claim it.  
Solution: Maintain an attempts item per row, and increment it on every claim. If it exceeds a certain count, mark the job as failed.  
Ideally though, the worker itself shouldn't crash on per-task errors. Let the lease expire instead.

### Per task overhead

Allows us to slow down all tasks, without setting their speed factor to the same slower value.

### Query Execution

Let's say you want to execute a query, and this depends on iterating over the results of another query. There are 2 ways to do it:

- Materialized view: Run the nested query only once, and hold that in a temporary store to use throughout.
- Subquery: Run the nested query every single time. Generally feasible when the outer query matches fewer rows.

Now, for a materialized view, there are 3 ways to execute this.

- Nested Loop: For all results in the subquery output, iterate over them and look them up in the main table. Possibly using indices.
- Hash semi join: Throw the subquery results in a hash table. Then, iterate over the main table once, and for every id, check if it's in our hash table.
- Merge join: When both sides are sorted on the join key.

### Task Claiming Query Correctness

The issue for item claiming for a given job came because the engine went with a subquery plan instead of a materialised plan. For every outer item row, it ran the innter query to see if this was a valid item. Since it was, it updated it, and moved on. For the second outer item, it ran the same query. This time the subquery skips item 1 since it has been updated.  
The same keeps happening for every outer item, and it is effectively a sliding window of 5 in the subquery, and every item gets picked.  
A materialized CTE upfront fixes this.

### Reasoning about scale

The problem statement gives us k < 100k and c < 1M.  
The number of files is relatively larger here.  
One merge tasks takes 5 files, with 1M values each. Each value is an int 32 -> 32 bits -> 4 bytes.  
So 5 _ 1M _ 4 = 20MB of input, and another 8MB of output (workers hold answer in int 64).  
That makes about 28MB at most per worker.  
Note: the worker internally doesn't even hold all 5 in memory at once, so total is closer to 16MB. However, the final task, because it writes to CSV, internally converts to python objects, touching up to 100MB. Still reasonable. Also happensonly once per job, and we could probably slice this final write too.

For generating a file with 1M values, node took ~100ms of CPU, single threaded.  
For 100k files, that is ~2.8 hours.  
More importantly, storage is 400 GB.

DB work  
About 100k item rows (1st layer). Over the life of the job, about 25k claims, commits, task rows.

Should we split tasks along C?
Memory is already constrained by number of files, and won't exceed 28MB for us.  
If we split along C, we could reduce this max limit, but nothing is under pressure.

When could splitting by C help?
If F is small, and C is large, this split would by us more parallelism.  
Parallelism today is controlled by W. For F=100k, we would have 20k tasks, which is orders of magnitude > W.  
With something like F=6, C=1M, we will create only 2 tasks, and both will run one after the other. The other workers sit idle. If we cut C into let's say k sections, we now have k independent trees to merge (and concatenate at the end).  
That means k times as many items, claims, and task rows. Final answer is assembled from all these k segments. 'Job done' means 'k ranges done'. Slightly more complex fan in and accounting.  
The point is, only the tail is where this will matter. When the final round is ongoing, and the items have reduced to <= 4W+1. With fan in 5, we have log(5)(W) levels where tasks < workers (only 1 for W=4).

Our bottleneck is still the generation. But, as we decided initially, this is not the focus of the assignment. We could also have the workers generate the files for leaves on the go. We would eliminate 400GB of writes and reads.

Postgres load  
25k claims per max job, each interleaved with seconds of work. At most W claims in parallel. Each claim costing O(W) rows. Trivial.  
Progress query (count(\*) over 100k items in a job) is quick because of the items_job_idx. We could optimise this with a items_remaining count if needed too.

Total reads across a job ~= 1.25 x total size, ~=500GB.

Tasks - 25k per max job. Index on job id for quick job stats. Could add an index on worker id for quick worker stats.
